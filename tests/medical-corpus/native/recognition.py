"""Run the app's OCR block and shared JS parser in an already booted iOS simulator.
This is a component check. The full application build is checked separately.
Usage: python3 tests/medical-corpus/native/recognition.py [simulator UDID]
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile

corpus = Path(__file__).resolve().parents[1]
repo = corpus.parents[1]
swift = """
import Foundation
import JavaScriptCore
let args = CommandLine.arguments
let js = JSContext()!
js.evaluateScript("let uid=()=>''; let todayLocal=()=>new Date().toLocaleDateString('sv-SE')")
js.evaluateScript(try String(contentsOfFile:args[1],encoding:.utf8))
var all = [[String:Any]]()
for file in args.dropFirst(2) {
    autoreleasepool {
        let url=URL(fileURLWithPath:file)
        var record:[String:Any] = ["file": url.lastPathComponent]
        do {
            let doc=try ClinicalOCR.read(Data(contentsOf:url),mime:url.pathExtension=="txt" ? "text/plain":"")
            let text=doc.text
            record["warnings"]=doc.warnings
            record["uncertainLineCount"]=doc.uncertainLines.count
            record["recognizedCharacters"]=text.count
            if url.deletingLastPathComponent().lastPathComponent=="labs" {
                let draft=js.objectForKeyedSubscript("parseLabText")!.call(withArguments:[text,url.lastPathComponent,doc.uncertainLines])!.toDictionary() as? [String:Any] ?? [:]
                record["draft"]=draft
                record["series"]=(draft["rows"] as? [[String:Any]] ?? []).map {row in
                    js.objectForKeyedSubscript("labSeriesPoint")!.call(withArguments:[row,draft["name"] ?? "",url.lastPathComponent])!.toDictionary() ?? [:]
                }
            } else {
                record["header"]=js.objectForKeyedSubscript("parseVisitHeader")!.call(withArguments:[text])!.toDictionary()
                record["medicines"]=js.objectForKeyedSubscript("proposedMedicines")!.call(withArguments:[text,doc.uncertainLines])!.toArray()
                record["recommendations"]=js.objectForKeyedSubscript("recommendationText")!.call(withArguments:[text])!.toString()
            }
            if let err=js.exception {record["error"]=err.toString();js.exception=nil}
        } catch { record["error"]=error.localizedDescription }
        all.append(record)
    }
}
let out=try JSONSerialization.data(withJSONObject:all,options:[.sortedKeys])
FileHandle.standardOutput.write(out)
"""

def output(*args):
    return subprocess.check_output(args, text=True).strip()

with tempfile.TemporaryDirectory(prefix="hs-corpus-vision-") as d:
    main = Path(d, "main.swift")
    exe = Path(d, "check")
    main.write_text(swift)
    sdk = output("xcrun", "--sdk", "iphonesimulator", "--show-sdk-path")
    device = sys.argv[1] if len(sys.argv)>1 else "booted"
    arch = "arm64" if subprocess.run(["sysctl","-n","hw.optional.arm64"],capture_output=True,text=True).stdout.strip()=="1" else "x86_64"
    subprocess.run(["xcrun","--sdk","iphonesimulator","swiftc","-target", arch+"-apple-ios17.0-simulator","-sdk",sdk,str(repo/"ios/HealthStory/ClinicalOCR.swift"),str(main),"-o",str(exe)],check=True)
    visit_cases = json.loads((corpus/"visits/expected.json").read_text())["cases"]
    lab_reports = json.loads((corpus/"labs/expected.json").read_text())["reports"]
    files = [corpus/"visits"/name for case in visit_cases for name in case["files"]]
    files += [corpus/"labs"/report["file"] for report in lab_reports]
    files += [corpus/"context"/name for name in ["история-лечения.txt","смешанный-слой.pdf"]]
    report = json.loads(output("xcrun","simctl","spawn",device,str(exe),str(repo/"assets/app/clinical-parser.js"),*map(str,files)))
    if len(report)!=len(files): raise RuntimeError("Incomplete simulator response")
    (corpus/"native/observed.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    for row in report: print(row["file"],row.get("recognizedCharacters"),row.get("error",""))

    import unicodedata
    rows={unicodedata.normalize("NFC",row["file"]):row for row in report}
    assert all("error" not in row for row in report)
    for case in visit_cases:
        first=rows[case["files"][0]]
        assert first["header"]["date"]==case["header"]["date"]
        assert first["header"]["clinic"]==case["clinic"]
        if case["id"]=="V03":
            assert first["medicines"][0]["strength"] in ("","? мг")
            assert not first["medicines"][0]["instructions"]
    mixed=rows["смешанный-слой.pdf"]["header"]
    assert mixed["date"]=="2026-04-04" and mixed["episodeName"]=="Синдром сухого глаза" and "Сухость глаз" in mixed["note"]
    series={}
    for report in lab_reports:
        doc=rows[report["file"]]
        assert doc["draft"]["date"]==report["date"]
        assert len(doc["draft"]["rows"])==len(report["rows"])
        for raw,point,expected in zip(doc["draft"]["rows"],doc["series"],report["rows"]):
            assert raw["value"].replace(",",".")==expected["value"].replace(",",".") and raw["unit"]==expected["unit"]
            if "canonicalValue" in expected:
                assert float(point["value"].replace(",","."))==expected["canonicalValue"]
                series.setdefault(expected["group"],set()).add(point["key"])
    assert all(len(keys)==1 for keys in series.values()) and series["glucose-plasma"]!=series["glucose-urine"]
    print("PASS mixed PDF, handwriting clarification, clinic and visit dates, lab values, normalized trends and specimen separation")
