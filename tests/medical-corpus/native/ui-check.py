"""Use a disposable *simulator* bundle ID; never installs on a physical device.
Usage: python3 tests/medical-corpus/native/ui-check.py <booted simulator UUID>.
Requires macOS with Xcode and node. All generated keys/data are synthetic QA.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

parser=argparse.ArgumentParser()
parser.add_argument("device")
parser.add_argument("--case",choices=["consultation","chatgpt","api-keys","cards","remove","treatment","review","review-direct","visit-files","layout","archive-unlock","archive-cloud-key","archive-inspection","sync","lab","batch","pharmacy-live","validation","record-links","parity"],default="consultation")
parser.add_argument("--sync-fixture",type=Path)
parser.add_argument("--sync-relay")
args=parser.parse_args()
sync_fixture=args.sync_fixture
if args.case=="sync" and (not sync_fixture or not args.sync_relay): parser.error("sync requires --sync-fixture and --sync-relay")
device=args.device
treatment=args.case=="treatment"
native=Path(__file__).resolve().parent
repo=native.parents[2]
bundle="by.healthstory.treatmentui" if treatment else "by.healthstory.medicalcorpus"
if args.case=="review": bundle="by.healthstory.review.evidence"
if args.case=="review-direct": bundle="by.healthstory.review.provider"
if args.case=="visit-files": bundle="by.healthstory.visitfiles.qa"
if args.case=="layout": bundle="by.healthstory.layout.qa"
if args.case=="archive-unlock": bundle="by.healthstory.archiveunlock.qa"
if args.case=="archive-cloud-key": bundle="by.healthstory.archivecloudkey.qa"
if args.case=="archive-inspection": bundle="by.healthstory.archiveinspection.qa"
if args.case=="batch": bundle="by.healthstory.batchvisit"
if args.case=="lab": bundle="by.healthstory.labintake"
if args.case=="sync": bundle="by.healthstory.medicalcorpus.sync"
if args.case=="chatgpt": bundle="by.healthstory.chatgpt.qa"
if args.case=="api-keys": bundle="by.healthstory.apikeys.qa"
if args.case=="pharmacy-live": bundle="by.healthstory.pharmacy.qa"
if args.case=="cards": bundle="by.healthstory.cardediting.qa"
if args.case=="remove": bundle="by.healthstory.recordremoval.qa"
if args.case=="validation": bundle="by.healthstory.validation.qa"
if args.case=="record-links": bundle="by.healthstory.recordlinks.qa"
if args.case=="parity": bundle="by.healthstory.parity.qa"
work=Path(tempfile.mkdtemp(prefix="hs-corpus-uitest-"))
print("Evidence:",work,flush=True)
ios=work/"ios"
project=ios/"HealthStory.xcodeproj"
shutil.copytree(repo/"ios",ios,ignore=shutil.ignore_patterns("build","xcuserdata"))
shutil.copytree(repo/"assets/app",work/"assets/app")
shutil.copy2(repo/"treatment.js",work/"treatment.js")
with (ios/"HealthStory.xcconfig").open("a") as out:out.write("\nPRODUCT_BUNDLE_IDENTIFIER = "+bundle+"\n")
(ios/"CorpusUI").mkdir()
if sync_fixture:
    fixture_root=repo/"tests/native-sync"
    shutil.copy(fixture_root/"SyncUI.swift",ios/"CorpusUI")
    shutil.copy(fixture_root/"QASeed.swift",ios/"HealthStory")
    main=ios/"HealthStory/HealthStoryApp.swift"
    code=main.read_text()
    assert "private var journal = DeviceJournal()" in code
    main.write_text(code.replace("private var journal = DeviceJournal()","private var journal = QASeed.open()"))
else:
    if args.case in ("chatgpt","review-direct"):
        shutil.copy(native/"ChatGPTFixture.swift",ios/"HealthStory")
        main=ios/"HealthStory/HealthStoryApp.swift"
        code=main.read_text()
        anchor=".onOpenURL"
        assert anchor in code
        main.write_text(code.replace(anchor,".environment(\\.nativeChatGPT, ChatGPTFixture.transport)\n                "+anchor,1))
    if args.case=="api-keys":
        shutil.copy(native/"APIKeyFixture.swift",ios/"HealthStory")
        providers=ios/"HealthStory/NativeAPIKeys.swift"
        source=providers.read_text()
        assert source.count("ChatGPTHTTP.load(request)")==1
        providers.write_text(source.replace("ChatGPTHTTP.load(request)","NativeAPIKeyFixture.load(request)"))
        journal = ios/"HealthStory/DeviceJournal.swift"
        with journal.open("a") as out:
            out.write("""
@MainActor extension DeviceJournal {
    func holdEditsForReplyTest() {
        busy = true
        Task {
            try? await Task.sleep(for: .seconds(2))
            busy = false
        }
    }
}
""")
        consultation = ios/"HealthStory/Consultations.swift"
        source = consultation.read_text()
        anchor = "let reply = try await transport.reply(messages)"
        assert source.count(anchor) == 1
        consultation.write_text(source.replace(anchor, anchor+"\n                    journal.holdEditsForReplyTest()"))
    if args.case=="lab":
        screen=ios/"HealthStory/LabIntake.swift"
        actual='Button("Выбрать фото или PDF из файлов"){picker=true}'
        assert actual in screen.read_text()
        screen.write_text(screen.read_text().replace(actual,'Button("Выбрать фото или PDF из файлов"){acceptFiles(["01-baseline.pdf","05-unclear.png","01-duplicate.pdf"].map{FileManager.default.urls(for:.documentDirectory,in:.userDomainMask)[0].appendingPathComponent($0)})}'))
    if args.case=="visit-files":
        target=ios/"HealthStory/VisitAttachments.swift"
        entry='Button("Выбрать файлы"){picker=true}'
        stub='Button("Выбрать файлы"){uploads += (1...2).map{_ in NativeUpload(category:"Рекомендации",name:"Рекомендации QA.txt",mime:"text/plain",bytes:Data("Рекомендации: контрольный осмотр".utf8))}}'
        assert entry in target.read_text()
        target.write_text(target.read_text().replace(entry,stub,1))
    if args.case=="archive-unlock":
        keychain=ios/"HealthStory/DeviceSecurity.swift"
        source=keychain.read_text()
        first=source.index("enum SavedArchiveKey {")
        last=source.index("func jsonObject(",first)
        keychain.write_text(source[:first]+(native/"ArchiveKeyFixture.swift").read_text()+"\n"+source[last:])
    if args.case=="archive-cloud-key":
        keychain=ios/"HealthStory/CloudArchiveKeys.swift"
        source=keychain.read_text().replace('"by.healthstory.icloud-archive"',json.dumps("by.healthstory.icloud-archive."+work.name))
        first=source.index("    private static func authorize(")
        last=source.index("    @MainActor",first)
        keychain.write_text(source[:first]+"    private static func authorize(_ reason: String) async throws {}\n\n"+source[last:])
    if args.case=="archive-inspection":
        target=ios/"HealthStory/DeviceViews.swift"
        anchor="NavigationLink {ArchiveBackupInspection()} label:"
        replacement='''NavigationLink {
            let url = URL.documentsDirectory.appending(path: "inspection.health")
            ArchiveBackupInspection(source: (try? Data(contentsOf: url)).map {
                ArchiveBackupInspection.Source(name: url.lastPathComponent, bytes: $0)
            })
        } label:'''
        source=target.read_text()
        assert source.count(anchor)==1
        target.write_text(source.replace(anchor,replacement,1))
    screens={"archive-unlock":"ArchiveUnlockUI","archive-cloud-key":"CloudArchiveKeyUI","archive-inspection":"ArchiveInspectionUI","layout":"LayoutUI","visit-files":"VisitAttachmentsUI","batch":"VisitBatchUI","lab":"LabUI","treatment":"TreatmentUI","review":"ReviewUI","review-direct":"ProviderReviewUI","chatgpt":"ChatGPTUI","cards":"CardEditingUI","remove":"RecordRemovalUI","pharmacy-live":"PharmacyLiveUI"}
    screens["validation"]="ValidationUI"
    screens["api-keys"]="APIKeysUI"
    screens["record-links"]="RecordLinksUI"
    screens["parity"]="ParityUI"
    shutil.copy(native/(screens.get(args.case,"ConsultationUI")+".swift"),ios/"CorpusUI")
project_file=project/"project.pbxproj"
data=json.loads(subprocess.check_output(["plutil","-convert","json","-o","-",project_file]))
objects=data["objects"]
main=data["rootObject"]
UID=lambda n:"D2"+str(n).zfill(22)
app=next((v for v in objects.values() if v.get("isa")=="PBXNativeTarget" and v.get("name")=="HealthStory"))
def insert(n,isa,**kwargs):objects[UID(n)]=dict(isa=isa,**kwargs)
insert(1,"PBXNativeTarget",buildConfigurationList=UID(2),buildPhases=[UID(3)],dependencies=[],fileSystemSynchronizedGroups=[UID(4)],name="CorpusUI",productName="CorpusUI",productReference=UID(5),productType="com.apple.product-type.bundle.ui-testing")
insert(2,"XCConfigurationList",buildConfigurations=[UID(6),UID(7)],defaultConfigurationName="Release")
insert(3,"PBXSourcesBuildPhase",files=[],buildActionMask="2147483647",runOnlyForDeploymentPostprocessing="0")
insert(4,"PBXFileSystemSynchronizedRootGroup",path="CorpusUI",sourceTree="<group>")
insert(5,"PBXFileReference",explicitFileType="wrapper.cfbundle",path="CorpusUI.xctest",sourceTree="BUILT_PRODUCTS_DIR")
for i,name in [(6,"Debug"),(7,"Release")]:
    insert(i,"XCBuildConfiguration",name=name,buildSettings=dict(PRODUCT_NAME="CorpusUI",PRODUCT_BUNDLE_IDENTIFIER=bundle+".test",TEST_TARGET_NAME="HealthStory",GENERATE_INFOPLIST_FILE="YES",TARGETED_DEVICE_FAMILY="1"))
objects[main]["targets"].append(UID(1));objects[objects[main]["mainGroup"]]["children"].append(UID(4))
project_file.write_bytes(plistlib.dumps(data))
scheme=ET.Element("Scheme",version="1.7")
entries=ET.SubElement(ET.SubElement(scheme,"BuildAction"),"BuildActionEntries")
def ref(el,uid,name,product):ET.SubElement(el,"BuildableReference",BuildableIdentifier="primary",BlueprintIdentifier=uid,BuildableName=product,BlueprintName=name,ReferencedContainer="container:HealthStory.xcodeproj")
ref(ET.SubElement(entries,"BuildActionEntry",buildForTesting="YES"),objects[main]["targets"][0],"HealthStory","HealthStory.app")
ref(ET.SubElement(entries,"BuildActionEntry",buildForTesting="YES"),UID(1),"CorpusUI","CorpusUI.xctest")
tests=ET.SubElement(ET.SubElement(scheme,"TestAction",buildConfiguration="Debug"),"Testables")
ref(ET.SubElement(tests,"TestableReference",skipped="NO"),UID(1),"CorpusUI","CorpusUI.xctest")
schemes=project/"xcshareddata/xcschemes";schemes.mkdir(parents=True,exist_ok=True);ET.ElementTree(scheme).write(schemes/"Corpus.xcscheme")
def run(*args,log=None):
    if log:
        with (work/log).open("w") as f:subprocess.run(args,check=True,stdout=f,stderr=subprocess.STDOUT)
    else:subprocess.run(args,check=True)
dest="platform=iOS Simulator,id="+device
out=work/"build"
spm=os.environ.get("HS_SWIFT_PACKAGES")
package_args=["-clonedSourcePackagesDirPath",spm,"-onlyUsePackageVersionsFromResolvedFile"] if spm else []
run("xcodebuild","build-for-testing","ONLY_ACTIVE_ARCH=YES",*package_args,"-project",project,"-scheme","Corpus","-destination",dest,"-derivedDataPath",out,log="build.log")
products=out/"Build/Products"
app=products/"Debug-iphonesimulator/HealthStory.app"
assert plistlib.loads((app/"Info.plist").read_bytes())["CFBundleIdentifier"]==bundle
run("xcrun","simctl","install",device,app)
sandbox=Path(subprocess.check_output(["xcrun","simctl","get_app_container",device,bundle,"data"],text=True).strip())
if sync_fixture:
    (sandbox/"Documents").mkdir(exist_ok=True)
    shutil.copy(sync_fixture,sandbox/"Documents/synthetic-sync.json")
    (sandbox/"Documents/qa-relay.txt").write_text(args.sync_relay)
else:
    profile={"files":[{"id":"analysis","visit":"v","category":"Лаборатория","lab":{"name":"Анализ крови","date":"2026-01-08","rows":[{"name":"Глюкоза","value":"120","unit":"мкмоль/л"}]}},
                      {"id":"intake","visit":"v","intake":True,"checked":True,"context":"ПРОВЕРЕННОЕ НАЗНАЧЕНИЕ"},
                      {"id":"pending","visit":"v","intake":True,"checked":False,"context":"НЕСВЕРЕННЫЙ ТЕКСТ"}],
             "fields":[],"episodes":[{"id":"ep","name":"Эпизод QA"}],
             "addedVisits":[["v","2026-01-08","Осмотр QA","d","Эпизод QA","Мая Макетова","scope","ep"]],
             "addedDoctors":[{"id":"d","values":["Врач Учебный","Терапевт","Стенд"]}],
             "notes":[{"id":"n","visit":"v","text":"СТЕНДОВАЯ ПОМЕТКА"}],
             "questions":[{"id":"q","episode":"ep","text":"ВОПРОС ЭПИЗОДА"}],
             "measurements":[{"id":"m","episode":"ep","name":"ИЗМЕРЕНИЕ ЭПИЗОДА","value":"34","unit":"см"}]}
    profile["examDrafts"]=[dict(id="exam-qa",exam="",fields=dict(method="УЗИ",region="Учебная область",date="2026-01-08",visit="v",conclusion="ЗАКЛЮЧЕНИЕ ОБСЛЕДОВАНИЯ"),parameters=[dict(id="exam-param",name="Размер",value="15",unit="мм")],sources=[dict(id="pending-exam",name="Учебный протокол.txt",type="text/plain",protocol=True,existing=False)],needsReview=True,reviewed=False)]
    profile["files"].append(dict(id="pending-exam",examDraft="exam-qa",name="Учебный протокол.txt",type="text/plain",category="Черновики обследований",date="2026-01-08",visit=""))
    profile["consultations"]=[dict(id="pending-old",question="Старый черновик",time="2026-01-01",prompt="Контакт example@example.org",answer="",provider=""),dict(id="sent-old",question="История передачи",time="2026-02-01",prompt="Уже переданный текст · OLD-QA-MARK",sentAt="2026-02-01",answer="Тестовый ответ",provider="QA")]
    if args.case=="chatgpt":
        profile["consultations"].append(dict(id="chatgpt-qa",question="QA ChatGPT",time="2026-02-02",prompt="First fixture question",answer="",provider=""))
    if args.case=="api-keys":
        profile["consultations"].append(dict(id="api-keys-qa",question="QA API keys",time="2026-02-02",prompt="Ответь одним словом: готово",answer="",provider=""))
    if args.case=="pharmacy-live":
        profile["addedVisits"][0].append([dict(id="catalog-qa",name="Парацетамол",strength="500 мг",form="таблетки",pack="№20")])
    if args.case=="batch":
        profile["files"]=[]
        profile["visitDrafts"]=[
            dict(id="source1",kind="Назначения",state="read",name="Назначение-QA.txt",type="text/plain",raw="FIRST FILE QA",
                 fields=dict(title="Визит из веба",doctor="d",episode="ep",date="2026-03-01",note="Проверка комплекта",recommendation="Проверить бланк"),
                 manualMeds=[dict(id="medicine",name="Учебный препарат",strength="2 мг",instructions="Учебная схема")]),
            dict(id="source2",parent="source1",kind="Рекомендации",state="read",name="Второй-QA.txt",type="text/plain",raw="SECOND FILE QA")]
    if args.case=="lab":
        profile["files"]=[
            dict(id="qa-hdl-"+str(i),name="Липидограмма QA "+date+".txt",type="text/plain",category="Лаборатория",date=date,visit="",
                 lab=dict(name="Липидограмма QA",rows=[dict(name=name,value=value,unit=unit,specimen=specimen)],
                          **({"date":"","documentDate":date} if i==0 else {"date":date})))
            for i,(date,name,value,unit,specimen) in enumerate([
                ("2022-01-11","ЛПВП-холестерин (HDL)","1,2","ммоль/л",""),
                ("2023-02-12","HDL-C","54","mg/dL",""),
                ("2024-03-13","Холестерин ЛПВП","1,4","ммоль/л","Сыворотка"),
            ])
        ]
        directory=sandbox/"Documents";directory.mkdir(exist_ok=True)
        for name in ["01-baseline.pdf","05-unclear.png"]: shutil.copy(repo/"tests/medical-corpus/labs"/name,directory/name)
        shutil.copy(repo/"tests/medical-corpus/labs/01-baseline.pdf",directory/"01-duplicate.pdf")
    if args.case=="validation":
        profile["files"].append(dict(
            id="validation-lab",name="Бланк для проверки.txt",category="Лаборатория",visit="",
            labDraft=dict(name="Validation lab",date="2026-01-08",rows=[
                dict(name="QA numeric",value="12",unit="",range="?")
            ])
        ))
    if treatment:
        from treatment_fixture import profile as treatment_profile, verify
        profile=treatment_profile()
    if args.case in ("review","review-direct"):
        from review_fixture import profile as review_profile, verify
        profile=review_profile()
    if args.case=="parity":
        profile["addedVisits"][0].append([dict(id="qa-previous",name="Учебный препарат",strength="5 мг",form="таблетки",instructions="Вымышленная схема")])
        profile["addedVisits"].append(["repeat","2026-01-10","Повторный визит QA","d","Эпизод QA","","scope","ep"])
        profile["files"][0]["name"]="Бланк QA.txt"
        profile["files"].append(dict(id="qa-pdf",name="Многостраничный бланк QA.pdf",category="Лаборатория",type="application/pdf",visit="",
            labDraft=dict(name="Учебный бланк",date="2026-01-08",rows=[dict(name="Показатель QA",value="1",unit="ед.")])))
    if args.case=="record-links":
        profile["addedDoctors"].append(dict(id="d-other",values=["Другой врач QA","Хирург","Стенд"]))
        profile["addedVisits"].append(["another","2026-01-07","Другой врач в эпизоде QA","d-other","Эпизод QA","","scope","ep"])
        profile["exams"]=[dict(id="exam-saved",method="УЗИ",region="Обследование QA",date="2026-01-08",description="Описание QA",attachments=[])]
        profile["examDrafts"]=[]
        profile["files"]=[f for f in profile["files"] if f["id"]!="pending-exam"]
        profile["files"].append(dict(id="existing-snap",name="Снимок из профиля.jpg",type="image/jpeg",category="Снимки",visit="v"))
    members=[dict(id="p-main",name="Мая Макетова",role="Взрослый"),dict(id="p-other",name="Другой профиль",role="Ребёнок")]
    family=dict(id="family-qa",kind="family",name="Стенд",adminId="p-main",members=members)
    payload=dict(version=2,data=dict(schemaVersion=2,family=family,profiles={"p-main":profile,"p-other":{"files":[],"fields":[{"id":"chronic","label":"QA","value":"PRIVATE-OTHER-PROFILE"}]}}),
                 files=[{"id":"p-main/"+f["id"],"type":"text/plain","bytes":base64.b64encode(b"QA").decode()} for f in profile["files"]])
    if args.case=="parity":
        original=next(f for f in payload["files"] if f["id"]=="p-main/analysis")
        original["bytes"]=base64.b64encode(b"QA SOURCE PREVIEW").decode()
        pdf=next(f for f in payload["files"] if f["id"]=="p-main/qa-pdf")
        pdf.update(type="application/pdf",bytes=base64.b64encode((repo/"tests/medical-corpus/visits/V02-two-page-visit.pdf").read_bytes()).decode())
    if args.case=="batch":
        payload["files"]=[dict(id="p-main/"+f["id"],type="text/plain",bytes=base64.b64encode(f["raw"].encode()).decode()) for f in profile["visitDrafts"]]
    if args.case=="record-links":
        payload["data"]["tags"]=[dict(id="archive-tag",name="Архив QA",keywords=[]),dict(id="visit-tag",name="Терапевт",keywords=[])]
        jpeg=(repo/"tests/medical-corpus/visits/V04-a-front.jpg").read_bytes()
        original=next(f for f in payload["files"] if f["id"]=="p-main/existing-snap")
        original.update(type="image/jpeg",bytes=base64.b64encode(jpeg).decode())
    folder=sandbox/"Library/Application Support";folder.mkdir(parents=True,exist_ok=True)
    encoder="""const {randomBytes,createCipheriv}=require('crypto'),fs=require('fs'),iv=randomBytes(12),c=createCipheriv('aes-256-gcm',Buffer.alloc(32,66),iv);fs.writeFileSync(process.argv[1],Buffer.concat([Buffer.from('HS01'),iv,c.update(fs.readFileSync(0)),c.final(),c.getAuthTag()]));"""
    original_archive=folder/"family.health"
    subprocess.run(["node","-e",encoder,original_archive],input=json.dumps(payload).encode(),check=True)
    if args.case=="archive-inspection":
        original_bytes=original_archive.read_bytes()
        inspection=sandbox/"Documents/inspection.health"
        inspection.parent.mkdir(exist_ok=True)
        pdf=(repo/"assets/documents/cbc.pdf").read_bytes()
        copy={"version":2,"data":{"schemaVersion":2,"family":{"id":"family-copy","kind":"family","name":"Семья из копии","adminId":"p-copy","members":[{"id":"p-copy","name":"Профиль из копии","role":"Взрослый"}]},"profiles":{"p-copy":{"files":[{"id":"proof","name":"Оригинал из копии.pdf"}]}}},"files":[{"id":"p-copy/proof","type":"application/pdf","bytes":base64.b64encode(pdf).decode()}]}
        subprocess.run(["node","-e",encoder,inspection],input=json.dumps(copy).encode(),check=True)
run("xcodebuild","test-without-building","-xctestrun",next(products.glob("Corpus*.xctestrun")),"-destination",dest,"-parallel-testing-enabled","NO","-resultBundlePath",work/"result.xcresult",log="test.log")
if treatment or args.case in ("review","review-direct","visit-files","lab","batch","cards","remove","record-links","validation","parity"):
    folder=Path(subprocess.check_output(["xcrun","simctl","get_app_container",device,bundle,"data"],text=True).strip())/"Library/Application Support"
    decoder="""const {createDecipheriv}=require('crypto'),fs=require('fs'),b=fs.readFileSync(process.argv[1]),c=createDecipheriv('aes-256-gcm',Buffer.alloc(32,66),b.subarray(4,16));c.setAuthTag(b.subarray(-16));process.stdout.write(Buffer.concat([c.update(b.subarray(16,-16)),c.final()]));"""
    saved=json.loads(subprocess.check_output(["node","-e",decoder,folder/"family.health"]))
    if args.case=="parity":
        profile=saved["data"]["profiles"]["p-main"]
        assert [row for row in profile["visitLinks"] if row["visit"]=="repeat" and row["target"]=="analysis"]
        assert len([f for f in saved["files"] if f["id"]=="p-main/analysis"])==1
        decision=next(row for row in profile["changes"] if row["visit"]=="repeat")
        assert decision["kind"]=="continue" and decision["medId"]=="qa-previous" and decision["before"]["strength"]=="5 мг"
        assert profile["addedVisits"][0][8][0]["id"]=="qa-previous"
        source=next(row for row in profile["files"] if row["id"]=="qa-pdf")["labPosition"]
        assert source["sourceId"]=="qa-pdf" and source["page"]==2, source
        print("PASS native episode history, preselected consultation, linked lab, original/fields switch and previous therapy decision")
        sys.exit(0)
    if args.case=="validation":
        p=saved["data"]["profiles"]["p-main"]
        visit=next(v for v in p["addedVisits"] if v[2]=="Validation visit")
        assert visit[8][0]["strength"]=="5 mg" and visit[8][0]["instructions"]=="Once daily"
        lab=next(f for f in p["files"] if f["id"]=="validation-lab")
        assert "labDraft" not in lab and lab["lab"]["rows"][0]["unit"]=="mg"
        assert any(m["name"]=="Validation measurement" and m["value"]=="37,2" for m in p["measurements"])
        exam=next(e for e in p["exams"] if e["method"]=="Validation exam")
        assert exam["date"]=="2026-01-08" and exam["parameters"][0]["value"]=="15"
        assert [draft["id"] for draft in p["examDrafts"]]==[draft["id"] for draft in profile["examDrafts"]]
        print("PASS simulator inline validation, immediate independent clearing, and persisted corrected visit, lab, exam and measurement")
        sys.exit(0)
    if args.case=="visit-files":
        p=saved["data"]["profiles"]["p-main"]
        files=[f for f in p["files"] if f.get("name")=="Рекомендации QA.txt"]
        assert len(files)==1 and files[0]["visit"]=="v" and files[0]["checked"]
        assert "контрольный осмотр" in files[0]["recommendation"]
        assert len(p["addedVisits"])==len(profile["addedVisits"])
        print("PASS native existing visit attachments, local OCR, explicit review, source and duplicate protection")
        sys.exit(0)
    if args.case=="remove":
        removed=saved["data"]["profiles"]["p-main"]
        assert removed["addedVisits"]==[] and removed["notes"]==[]
        assert "analysis" not in {f["id"] for f in removed["files"]}
        assert all(not f["visit"] for f in removed["files"])
        assert "p-main/analysis" not in {f["id"] for f in saved["files"]}
        assert "p-main/intake" in {f["id"] for f in saved["files"]}
        assert len(saved["data"]["profiles"])==2
        print("PASS native deletion, separate originals retained, encrypted archive readback")
        sys.exit(0)
    if args.case=="cards":
        observed=saved["data"]["profiles"]["p-main"]
        assert len(observed["addedVisits"])==len(profile["addedVisits"])+1
        assert len(observed["episodes"])==len(profile["episodes"])+1
        updated=next(v for v in observed["addedVisits"] if v[2]=="QA exact visit edited")
        assert updated[5]=="QA visit details"
        assert observed["addedVisits"][-1][0]=="v"
        print("PASS native repeated visit, open existing, edit visit and preserve the original archive")
        sys.exit(0)
    if args.case=="record-links":
        after=saved["data"]["profiles"]["p-main"]
        assert after["exams"][0]["attachments"]==[{"id":"existing-snap"}]
        assert after["files"]==profile["files"]
        assert next(r for r in after["tagEdits"] if r["id"]=="visit:v")["values"]=={"archive-tag":True}
        originals=[f for f in saved["files"] if f["id"]=="p-main/existing-snap"]
        assert len(originals)==1 and base64.b64decode(originals[0]["bytes"])==jpeg
        print("PASS doctor history stays scoped, tag override persisted, one existing JPEG and one attachment link")
        sys.exit(0)
    if args.case=="batch":
        p=saved["data"]["profiles"]["p-main"]
        assert not p["visitDrafts"] and len(p["addedVisits"])==len(profile["addedVisits"])+1
        row=next(v for v in p["addedVisits"] if v[2]=="Визит из веба")
        assert row[7]=="ep" and row[8][0]["strength"]=="2 мг" and row[5]=="Проверка комплекта"
        assert len(p["files"])==2 and all(f["visit"]==row[0] for f in p["files"])
        transcribed=next(f for f in p["files"] if f.get("transcription"))
        assert "Не перезаписывать ручную правку" in transcribed["transcription"]
        assert transcribed["raw"] in {"FIRST FILE QA","SECOND FILE QA"}
        assert sorted(f["id"] for f in saved["files"])==["p-main/source1","p-main/source2"]
        assert {base64.b64decode(f["bytes"]) for f in saved["files"]}=={b"FIRST FILE QA",b"SECOND FILE QA"}
        print("PASS resumed web batch, corrected transcript, unchanged originals and manually entered fields")
        sys.exit(0)
    if args.case=="lab":
        import hashlib
        saved_files=saved["data"]["profiles"]["p-main"]["files"]
        assert [f for f in saved_files if f["id"].startswith("qa-hdl-")]==profile["files"]
        records=[f for f in saved_files if not f["id"].startswith("qa-hdl-")]
        assert len(records)==2 and all(not f["visit"] for f in records)
        assert len(saved["data"]["profiles"]["p-main"]["addedVisits"])==len(profile["addedVisits"])
        originals={f["id"]:base64.b64decode(f["bytes"]) for f in saved["files"]}
        for f in records:
            expected=(repo/"tests/medical-corpus/labs"/f["name"]).read_bytes()
            assert hashlib.sha256(originals["p-main/"+f["id"]]).digest()==hashlib.sha256(expected).digest()
        baseline=next(f for f in records if f["name"].endswith(".pdf"))
        assert "labDraft" not in baseline and baseline["lab"]["date"]=="2025-01-08"
        assert any(r["name"]=="Гемоглобин" and r["value"]=="132" and r["unit"]=="г/л" for r in baseline["lab"]["rows"])
        image=next(f for f in records if f["name"].endswith(".png"))
        assert "lab" not in image and image["labDraft"]["rows"], "the second file must be recognized without opening it"
        print("PASS batch PDF+image recognition, verified result, direct profile search and both original SHA-256 values")
        sys.exit(0)
    if args.case=="review-direct":
        reviewed=saved["data"]["profiles"]["p-main"]
        review=reviewed["reviews"][-1]
        assert len(reviewed["reviews"])==1 and not reviewed["treatmentQueue"]
        assert review["kind"]=="provider" and review["provider"]=="ChatGPT · Учебная модель"
        assert review["answer"]=="Учебный ответ по лечению" and review["items"][0]["label"]=="Недостаточно данных для оценки"
        assert "TEST-CLAIM" in review["prompt"] and "QA-анализ" in review["prompt"]
        assert all(x not in review["prompt"] for x in ["example.org","Private-filename.pdf","Рина Примерова","Мая Макетова","PRIVATE-OTHER-PROFILE"])
        assert len(review["transfers"])==1 and review["transfers"][0]["actorId"]=="p-main"
        assert reviewed["addedVisits"]==profile["addedVisits"]
        print("PASS native direct treatment review, preview redaction, quota, saved request and result")
        sys.exit(0)
    verify(saved["data"]["profiles"]["p-main"],profile)
    print("PASS native treatment review, transfer and prescription snapshots" if args.case=="review" else "PASS native active courses, scoped brief, dated and unknown completion, persisted source periods and author")
else:
    if args.case=="chatgpt":
        print("PASS native ChatGPT HTTPS contract, redacted history, quota, draft reopen, retry and saved answers")
    elif args.case=="api-keys":
        print("PASS native DeepSeek and Anthropic key validation, consultation, follow-up, and Keychain reuse")
    elif args.case=="archive-unlock":
        print("PASS optional archive key, reopen after relaunch, forget and manual fallback (synthetic keychain)")
    elif args.case=="archive-cloud-key":
        print("PASS explicit iCloud key save, reopen after relaunch, removal and manual fallback (simulator Keychain with authentication stubbed)")
    elif args.case=="archive-inspection":
        current_sandbox=Path(subprocess.check_output(["xcrun","simctl","get_app_container",device,bundle,"data"],text=True).strip())
        assert (current_sandbox/"Library/Application Support/family.health").read_bytes()==original_bytes
        print("PASS verified a separate family copy and opened its PDF with the working archive unchanged")
    elif args.case=="layout":
        print("PASS native profile, visit and summary at standard and accessibility font sizes")
    elif args.case=="pharmacy-live":
        print("PASS native live catalogue, exact catalogue item price, Minsk and nationwide search")
    else:
        print("PASS native conflict resolution and persisted offline episode" if sync_fixture else "PASS synthetic native consultation, privacy, selected episode context, manual copy and saved answer")
