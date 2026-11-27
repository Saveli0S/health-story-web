import Foundation

@main struct DriveContract {
    @MainActor static func main() async throws {
        let token="synthetic-session"
        var payload=Data("HS01".utf8);payload.append(Data(repeating:42,count:8*1024*1024+7))
        let digest=DriveArchives.digest(payload),size=payload.count
        let original: [String:Any]=["id":"qa","name":"archive-qa.health","size":String(size),"md5Checksum":digest,"capabilities":["canTrash":true]]
        var received=Data(),starts=0,interrupted=false,listed=0,trashRequests=0
        func response(_ url:URL,_ status:Int,_ body:Data=Data(),_ headers:[String:String]=[:])->(Data,URLResponse){
            (body,HTTPURLResponse(url:url,statusCode:status,httpVersion:"HTTP/1.1",headerFields:headers)!)
        }
        let drive=DriveArchives(token:{token}) { req in
            let url=req.url!
            precondition(url.host=="www.googleapis.com" && req.value(forHTTPHeaderField:"Authorization")=="Bearer "+token)
            let query=URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems ?? []
            if url.path=="/drive/v3/files" {
                precondition(query.contains{ $0.name=="q" && $0.value?.contains("healthArchive' and value='HS01'")==true })
                listed+=1
                let page:[String:Any]=listed==1 ? ["files":[],"nextPageToken":"qaPage"]:["files":trashRequests==2 ? []:[original]]
                if listed==2 {precondition(query.contains{ $0.name=="pageToken" && $0.value=="qaPage" })}
                return try response(url,200,JSONSerialization.data(withJSONObject:page))
            }
            if url.path=="/drive/v3/files/qa" {
                if req.httpMethod=="PATCH" {
                    precondition(query==[URLQueryItem(name:"fields",value:"id,trashed")])
                    let patch=try JSONDecoder().decode([String:Bool].self,from:req.httpBody!)
                    precondition(patch==["trashed":true])
                    trashRequests+=1
                    return response(url,200,Data((trashRequests==1 ? #"{"id":"qa","trashed":false}"# : #"{"id":"qa","trashed":true}"#).utf8))
                }
                return response(url,200,payload)
            }
            if req.httpMethod=="POST" {
                starts+=1;let meta=try JSONSerialization.jsonObject(with:req.httpBody!) as! [String:Any]
                precondition((meta["appProperties"] as? [String:String])==["healthArchive":"HS01"])
                return response(url,200,Data(),["Location":"https://www.googleapis.com/session/qa"])
            }
            let range=req.value(forHTTPHeaderField:"Content-Range")!
            if range.hasPrefix("bytes */") {return response(url,308,Data(),["Range":"bytes=0-"+String(received.count-1)])}
            precondition(range.hasPrefix("bytes "+String(received.count)+"-"))
            received.append(req.httpBody!)
            if !interrupted {interrupted=true;throw URLError(.networkConnectionLost)}
            precondition(received==payload)
            return try response(url,201,JSONSerialization.data(withJSONObject:original))
        }
        do {try await drive.upload(payload){_ in};fatalError("Missing interrupted upload")}catch is URLError{}
        var progress=0;try await drive.upload(payload){progress=$0};precondition(progress==100 && starts==1)
        let copies=try await drive.copies();precondition(copies.count==1 && listed==2)
        let downloaded=try await drive.download(copies[0]);precondition(downloaded==payload)
        let protected=try JSONDecoder().decode(DriveCopy.self,from:Data(#"{"id":"protected","name":"protected.health","capabilities":{"canTrash":false}}"#.utf8))
        do {try await drive.trash(protected);fatalError("Protected file accepted")}catch is DriveFailure{}
        precondition(trashRequests==0)
        do {try await drive.trash(copies[0]);fatalError("Unconfirmed receipt accepted")}catch is DriveFailure{}
        try await drive.trash(copies[0]);precondition(trashRequests==2)
        let remaining=try await drive.copies();precondition(remaining.isEmpty)
        var sent=0
        let unsafe=DriveArchives(token:{token}) {req in sent+=1;return response(req.url!,200,Data(),["Location":"https://example.invalid/session"])}
        do{try await unsafe.upload(payload){_ in};fatalError("Untrusted upload destination")}catch is DriveFailure{}
        precondition(sent==1)
        let broken=DriveArchives(token:{token}){req in response(req.url!,200,Data("HS01truncated".utf8))}
        do{_=try await broken.download(copies[0]);fatalError("Partial copy accepted")}catch is DriveFailure{}
        var corrupt=payload
        corrupt[corrupt.index(before:corrupt.endIndex)] ^= 1
        let wrongDigest=DriveArchives(token:{token}){req in response(req.url!,200,corrupt)}
        do{_=try await wrongDigest.download(copies[0]);fatalError("Changed copy accepted")}catch is DriveFailure{}
        print("PASS native Drive resumable upload, list pagination, checksum, protected copy and confirmed trash")
    }
}
