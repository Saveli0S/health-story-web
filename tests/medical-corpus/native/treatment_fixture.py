"""Deliberately synthetic cross-client treatment records; used by ui-check.py --case treatment."""
def profile():
    def med(ident,name,dose,**period):
        return dict(id=ident,name=name,strength=dose,form="таблетки",instructions="Учебная схема",period=dict(start="2025-04-01",planned="",end="",closed=False,unknown=False,note="")|period)
    manual=med("rx-manual","Фикстурин","5 мг");paper=med("rx-paper","Бланкин","10 мг")
    stopped=med("rx-stopped","Старый","3 мг");replaced=med("rx-old","Сменённый","2 мг")
    replacement=med("rx-replacement","Заменитель","20 мг")
    p={"files":[dict(id="f1",visit="v1",name="Сверенное назначение",category="Назначения",checked=True,meds=[paper]),
        dict(id="f2",visit="v1",name="Черновик",category="Назначения",checked=False,meds=[med("rx-pending","Непроверенный","2 мг")]),
        dict(id="fb",visit="v1",name="Кровь",category="Лаборатория",lab=dict(name="Анализ крови QA",date="2025-04-01",rows=[])),
        dict(id="fx",visit="other",name="Посторонний бланк",category="Лаборатория",lab=dict(name="Посторонний бланк",date="2025-04-03",rows=[]))],
        "fields":[],"episodes":[dict(id="ep",name="Учебный эпизод"),dict(id="foreign",name="Посторонний эпизод")],
        "addedVisits":[["v1","2025-04-01","Первичный осмотр QA","d","Учебный эпизод","Жалобы на первом визите","scope","ep",[manual,stopped,replaced]],
        ["v2","2025-04-02","Повторный осмотр QA","d","Учебный эпизод","Контроль","scope","ep"],
        ["other","2025-04-03","Посторонний визит","d","Посторонний эпизод","Другая причина","scope","foreign"]],
        "changes":[dict(id="stop",visit="v2",source="v1",episode="ep",date="2025-04-02",doctor="d",kind="stop",medId="rx-stopped",before=stopped),
            dict(id="replace",visit="v2",source="v1",episode="ep",date="2025-04-02",doctor="d",kind="replace",medId="rx-old",before=replaced,replacement=replacement)],
        "addedDoctors":[dict(id="d",values=["Доктор QA","Терапевт",""])],"notes":[],"questions":[dict(id="q",episode="ep",text="Вопрос этого эпизода")]}
    return p

def verify(saved, original):
    by_id=lambda m:m["id"]
    def meds(p):return sorted(p["addedVisits"][0][8]+p["files"][0]["meds"]+[p["changes"][1]["replacement"]],key=by_id)
    before,after=meds(original),meds(saved)
    for a,b in zip(before,after,strict=True):
        assert {k:v for k,v in a.items() if k!="period"} == {k:v for k,v in b.items() if k!="period"}
        if a["id"] in ["rx-manual","rx-paper"]:
            assert b["period"]["closed"] and b["period"]["end"] and not b["period"]["unknown"]
        elif a["id"]=="rx-replacement":
            assert b["period"]["closed"] and b["period"]["unknown"] and not b["period"]["end"]
        else:
            assert a==b
        if a["id"]=="rx-paper":assert b["period"]["note"]=="Course timing confirmed"
    assert saved["files"][1:]==original["files"][1:]
    assert any(n["text"]=="Shared QA note" and n["author"]=="Мая Макетова" and n["time"] and n["visit"]=="v1" for n in saved["notes"])
