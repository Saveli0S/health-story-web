import XCTest

final class VisitBatchUI:XCTestCase {
    let app=XCUIApplication()
    func profile(){
        app.launch()
        let key=app.secureTextFields.firstMatch
        if key.waitForExistence(timeout:4){key.tap();key.typeText("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI");app.buttons["Открыть архив"].tap()}
        app.buttons["Мая Макетова"].tap()
    }
    func show(_ control:XCUIElement){
        for _ in 0..<12{if control.exists && control.isHittable{return};app.swipeUp()}
        XCTFail(control.debugDescription)
    }
    func testResumeWebBatch(){
        continueAfterFailure=false
        profile()
        let batch=app.buttons["Назначение-QA.txt"];show(batch);batch.tap()
        XCTAssertTrue(app.textFields["Название визита"].waitForExistence(timeout:10))
        XCTAssertTrue(app.textFields.matching(NSPredicate(format:"value == %@", "Визит из веба")).firstMatch.waitForExistence(timeout:10),app.debugDescription)
        let original=app.buttons["Открыть оригинал · Второй-QA.txt"];show(original);original.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format:"label CONTAINS 'SECOND FILE QA'")).firstMatch.waitForExistence(timeout:6))
        app.navigationBars.buttons.firstMatch.tap()
        let transcription=app.buttons.matching(identifier:"Уточнить текст с оригинала").firstMatch
        show(transcription);transcription.tap()
        let text=app.textFields["Сверенный текст"]
        XCTAssertTrue(text.waitForExistence(timeout:5),app.debugDescription)
        text.tap();text.typeText("\nЖалобы: Не перезаписывать ручную правку")
        app.buttons["Заполнить пропуски"].tap()
        XCTAssertTrue(app.navigationBars["Новый визит"].waitForExistence(timeout:6),app.debugDescription)
        let later=app.buttons["Отложить сверку визита"];show(later);later.tap()
        app.terminate();profile();show(batch);batch.tap()
        XCTAssertTrue(app.textFields.matching(NSPredicate(format:"value == %@", "Визит из веба")).firstMatch.waitForExistence(timeout:6),app.debugDescription)
        let check=app.switches["Поля и дата сверены с оригиналами"];show(check)
        for x in [0.88,0.85,0.93] where check.value as? String != "1" {
            check.coordinate(withNormalizedOffset:CGVector(dx:x,dy:0.5)).tap()
        }
        XCTAssertEqual(check.value as? String,"1",app.debugDescription)
        XCTAssertTrue(app.buttons["Сохранить"].isEnabled,app.debugDescription)
        app.buttons["Сохранить"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format:"label CONTAINS 'Визит из веба'")).firstMatch.waitForExistence(timeout:8),app.debugDescription)
        XCTAssertFalse(batch.exists)
    }
}
