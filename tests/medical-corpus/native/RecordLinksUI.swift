import XCTest

final class RecordLinksUI:XCTestCase {
    func testDoctorTagAndExistingExamFile() {
        continueAfterFailure=false
        let app=XCUIApplication();app.launch()
        let key=app.secureTextFields.firstMatch
        if key.waitForExistence(timeout:5){
            key.tap();key.typeText("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI")
            app.buttons["Открыть архив"].tap()
        }
        app.buttons["Мая Макетова"].tap()
        func reach(_ element:XCUIElement) {
            for _ in 0..<9 {
                if element.exists && element.isHittable {element.tap();return}
                app.swipeUp()
            }
            XCTFail("Недоступен элемент "+element.debugDescription)
        }
        let visit=app.buttons.matching(NSPredicate(format:"label CONTAINS 'Осмотр QA'")).firstMatch
        reach(visit)
        reach(app.buttons["doctor-card-d"])
        XCTAssertTrue(app.navigationBars["Врач"].waitForExistence(timeout:5))
        XCTAssertTrue(app.staticTexts["Врач Учебный"].exists)
        XCTAssertFalse(app.staticTexts["Другой врач в эпизоде QA"].exists)
        app.navigationBars.buttons.firstMatch.tap()
        reach(app.buttons["Изменить теги"])
        let tag=app.switches["record-tag-archive-tag"]
        XCTAssertTrue(tag.waitForExistence(timeout:5),app.debugDescription)
        tag.coordinate(withNormalizedOffset:CGVector(dx:0.90,dy:0.5)).tap()
        XCTAssertEqual(tag.value as? String,"1",app.debugDescription)
        app.buttons["Сохранить теги"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format:"label CONTAINS 'Архив QA'")).firstMatch.waitForExistence(timeout:5))
        app.navigationBars.buttons.firstMatch.tap()
        reach(app.buttons.matching(NSPredicate(format:"label CONTAINS 'Результаты обследований'")).firstMatch)
        reach(app.buttons.matching(NSPredicate(format:"label CONTAINS 'Обследование QA'")).firstMatch)
        reach(app.buttons["Редактировать"])
        reach(app.buttons["Снимок"])
        reach(app.buttons["Из документов профиля"])
        reach(app.buttons["Снимок из профиля.jpg"])
        reach(app.buttons["Сохранить обследование"])
        XCTAssertTrue(app.navigationBars["Обследование"].waitForExistence(timeout:8),app.debugDescription)
        reach(app.buttons["Снимок из профиля.jpg"])
        XCTAssertTrue(app.navigationBars["Снимок из профиля.jpg"].waitForExistence(timeout:8),app.debugDescription)
    }
}
