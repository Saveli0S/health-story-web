import Foundation
import CryptoKit

struct DriveCopy:Decodable,Identifiable {
    struct Capabilities:Decodable {let canTrash:Bool?}
    let id:String,name:String,size:String?,modifiedTime:String?,md5Checksum:String?
    let capabilities:Capabilities?
    var canTrash:Bool {capabilities?.canTrash==true}
}

private final class DriveSessionDelegate:NSObject,URLSessionTaskDelegate {
    func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,
                    newRequest request:URLRequest,completionHandler:@escaping (URLRequest?)->Void){completionHandler(nil)}
}

struct DriveFailure:LocalizedError {
    let reason:String
    var errorDescription:String?{reason}
    init(_ reason:String){self.reason=reason}
}

@MainActor final class DriveArchives {
    typealias Transport=(URLRequest) async throws -> (Data,URLResponse)
    let transport:Transport
    let token:() async throws -> String
    private var job:(url:URL,digest:String)?
    init(token:@escaping () async throws->String,transport:Transport?=nil){
        self.token=token
        let session=URLSession(configuration:.ephemeral,delegate:DriveSessionDelegate(),delegateQueue:nil)
        self.transport=transport ?? {req in try await session.data(for:req)}
    }
    static func digest(_ data:Data)->String {Insecure.MD5.hash(data:data).map{String(format:"%02x",$0)}.joined()}
    private func send(_ url:URL,_ method:String="GET",headers:[String:String]=[:],body:Data?=nil) async throws -> (Data,HTTPURLResponse) {
        guard url.scheme=="https",url.host=="www.googleapis.com",url.user==nil,url.password==nil,url.port==nil else {throw DriveFailure("Не удалось проверить адрес Google Диска.")}
        var req=URLRequest(url:url,cachePolicy:.reloadIgnoringLocalCacheData,timeoutInterval:120)
        req.httpMethod=method;req.httpBody=body
        for (k,v) in headers{req.setValue(v,forHTTPHeaderField:k)}
        req.setValue("Bearer "+(try await token()),forHTTPHeaderField:"Authorization")
        let (data,response)=try await transport(req)
        guard let http=response as? HTTPURLResponse else {throw DriveFailure("Некорректный ответ Google Диска.")}
        switch http.statusCode {
        case 200..<300,308:return(data,http)
        case 401:throw DriveFailure("Срок доступа истёк. Войдите в Google Диск ещё раз.")
        case 403,507:throw DriveFailure("Проверьте доступ к файлам приложения и свободное место на Google Диске.")
        case 404,410:job=nil;throw DriveFailure("Файл или сеанс загрузки недоступен. Обновите список и повторите.")
        default:throw DriveFailure("Google Диск временно недоступен (HTTP "+String(http.statusCode)+").")
        }
    }
    func resetSession(){job=nil}

    func copies() async throws->[DriveCopy] {
        struct Page:Decodable {let files:[DriveCopy],nextPageToken:String?}
        var files=[DriveCopy](),page:String?,seen=Set<String>()
        repeat {
            var url=URLComponents(string:"https://www.googleapis.com/drive/v3/files")!
            url.queryItems=[URLQueryItem(name:"q",value:"trashed = false and appProperties has { key='healthArchive' and value='HS01' }"),
                            URLQueryItem(name:"fields",value:"nextPageToken,files(id,name,size,modifiedTime,md5Checksum,capabilities(canTrash))"),
                            URLQueryItem(name:"orderBy",value:"modifiedTime desc"),URLQueryItem(name:"pageSize",value:"100")]
            if let page {guard seen.insert(page).inserted else {throw DriveFailure("Не удалось прочитать список копий.")};url.queryItems?.append(URLQueryItem(name:"pageToken",value:page))}
            let (data,_)=try await send(url.url!)
            let result=try JSONDecoder().decode(Page.self,from:data);files+=result.files;page=result.nextPageToken
        }while page != nil
        return files
    }
    func trash(_ file:DriveCopy) async throws {
        guard file.canTrash,file.id.range(of:"^[A-Za-z0-9_-]+$",options:.regularExpression) != nil else {
            throw DriveFailure("Google Диск не разрешает удалить эту копию.")
        }
        let url=URL(string:"https://www.googleapis.com/drive/v3/files/"+file.id+"?fields=id,trashed")!
        let body=try JSONEncoder().encode(["trashed":true])
        let (data,_)=try await send(url,"PATCH",headers:["Content-Type":"application/json"],body:body)
        struct Receipt:Decodable {let id:String,trashed:Bool}
        guard let receipt=try? JSONDecoder().decode(Receipt.self,from:data),receipt.id==file.id,receipt.trashed else {
            throw DriveFailure("Google Диск не подтвердил перенос копии в корзину. Обновите список.")
        }
    }
    func download(_ file:DriveCopy) async throws -> Data {
        guard file.id.range(of:"^[A-Za-z0-9_-]+$",options:.regularExpression) != nil else{throw DriveFailure("Некорректная ссылка на файл.")}
        let (data,_)=try await send(URL(string:"https://www.googleapis.com/drive/v3/files/"+file.id+"?alt=media")!)
        guard data.starts(with:Data("HS01".utf8)), file.size==nil || file.size==String(data.count),
              file.md5Checksum==nil || file.md5Checksum==Self.digest(data) else {throw DriveFailure("Копия получена не полностью или имеет другой формат.")}
        return data
    }
    func upload(_ data:Data,progress:(Int)->Void) async throws {
        guard data.starts(with:Data("HS01".utf8)) else {throw DriveFailure("Выберите зашифрованную семейную копию.")}
        let digest=Self.digest(data),total=data.count
        var resuming=true
        if job?.digest != digest {
            let date=ISO8601DateFormatter().string(from:Date()).replacingOccurrences(of:":",with:"-")
            let meta:[String:Any]=["name":"archive-"+date+".health","mimeType":"application/octet-stream","appProperties":["healthArchive":"HS01"]]
            let (_,http)=try await send(URL(string:"https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size,md5Checksum")!,"POST",
                headers:["Content-Type":"application/json","X-Upload-Content-Type":"application/octet-stream","X-Upload-Content-Length":String(total)],
                body:try JSONSerialization.data(withJSONObject:meta))
            guard let raw=http.value(forHTTPHeaderField:"Location"),let url=URL(string:raw) else {throw DriveFailure("Google Диск не открыл загрузку.")}
            job=(url,digest);resuming=false
        }
        guard let url=job?.url else{throw DriveFailure("Загрузка не начата.")}
        var offset=0
        while offset<total {
            let end=resuming ? 0:min(total,offset+8*1024*1024)
            let range=resuming ? "bytes */"+String(total):"bytes "+String(offset)+"-"+String(end-1)+"/"+String(total)
            let (receipt,http)=try await send(url,"PUT",headers:["Content-Range":range,"Content-Type":"application/octet-stream"],
                                               body:resuming ? Data():data.subdata(in:offset..<end))
            if http.statusCode != 308 {
                let info=try JSONSerialization.jsonObject(with:receipt) as? [String:Any]
                guard info?["id"] is String,info?["size"] as? String==String(total),info?["md5Checksum"] as? String==digest else{throw DriveFailure("Google Диск не подтвердил размер и контрольную сумму копии.")}
                job=nil;progress(100);return
            }
            let header=http.value(forHTTPHeaderField:"Range")
            var next=0
            if let header {
                guard header.hasPrefix("bytes=0-"),let last=Int(header.dropFirst(8)),last>=0,last<total-1 else {throw DriveFailure("Некорректный диапазон загруженных данных.")}
                next=last+1
            }
            guard resuming || (next>offset && next<=end) else {throw DriveFailure("Передача приостановлена. Повторите загрузку.")}
            offset=next;resuming=false;progress(offset*100/total)
        }
    }
}
