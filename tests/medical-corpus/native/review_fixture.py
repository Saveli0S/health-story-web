def profile():
    p={"fields":[{"id":"birthday","label":"Дата рождения","value":"2000-01-15"}],"files":[{"id":"lab","name":"Private-filename.pdf","category":"Лаборатория","visit":"r","lab":{"date":"2026-04-02","name":"Биохимия","rows":[{"name":"QA-анализ","value":"22","unit":"ед/л"}]}}],
       "addedDoctors":[{"id":"d","values":["Рина Примерова","Терапевт","Учебный кабинет"]}],
       "addedVisits":[["r","2026-04-02","Синтетический осмотр","d","Учебный эпизод","Мая Макетова, Учебный кабинет, Private-filename.pdf; TEST-CLAIM","scope","e",[{"id":"r1","name":"Стендол","strength":"5 мг","form":"таблетки","instructions":"Учебная схема"}]]],
       "episodes":[{"id":"e","name":"Учебный эпизод"}]}
    return p

def verify(saved,original):
    review=saved["reviews"][-1]
    assert review["visit"]=="r" and review["kind"]=="manual" and review["answer"]=="Synthetic answer"
    assert "TEST-CLAIM" in review["prompt"] and "QA-анализ" in review["prompt"]
    assert all(w not in review["prompt"] for w in ["Мая Макетова","Учебный кабинет","Private-filename.pdf","Рина Примерова","PRIVATE-OTHER-PROFILE"])
    assert review["payload"]["пациент"]["Возраст на дату визита"]=="26 лет"
    assert [t["kind"] for t in review["transfers"]]==["copy","answer"] and all(t["actorName"]=="Мая Макетова" and t["actorId"]=="p-main" and t["time"] for t in review["transfers"])
    assert review["items"][0]["label"]=="Недостаточно данных для оценки"
    assert saved["addedVisits"]==original["addedVisits"]
