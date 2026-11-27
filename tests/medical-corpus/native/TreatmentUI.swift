import XCTest

final class TreatmentUI:XCTestCase {
    func testPeriodsAndEpisodeBrief() throws {
        continueAfterFailure=false
        let app=XCUIApplication();app.launch()
        func tap(_ e:XCUIElement,file:StaticString=#filePath,line:UInt=#line){
            for attempt in 0..<12 {
                if e.waitForExistence(timeout:1),e.wait(for:\.isHittable,toEqual:true,timeout:1),app.frame.intersects(e.frame){
                    e.tap();return
                }
                if attempt<4 {app.swipeUp()} else {app.swipeDown()}
            }
            XCTFail("Control unavailable: "+e.description+" "+app.debugDescription,file:file,line:line)
        }
        let key=app.secureTextFields.firstMatch;XCTAssertTrue(key.waitForExistence(timeout:12));key.tap()
        key.typeText("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI")
        tap(app.buttons["Открыть архив"]);tap(app.buttons["Мая Макетова"])
        let manual=app.buttons["course-period-rx-manual"],pdf=app.buttons["course-period-rx-paper"]
        XCTAssertTrue(manual.waitForExistence(timeout:6))
        XCTAssertFalse(app.buttons["course-period-rx-pending"].exists)
        XCTAssertFalse(app.buttons["course-period-rx-stopped"].exists)
        tap(pdf)
        let note=app.textFields["Пометка при прерывании"];tap(note);note.typeText("Course timing confirmed")
        tap(app.buttons["Сохранить даты"])
        tap(app.buttons["course-finish-v1"])
        tap(app.buttons["Подтвердить завершение"])
        XCTAssertTrue(manual.waitForNonExistence(timeout:5))
        app.swipeDown();app.swipeDown()
        let replacement=app.buttons["course-period-rx-replacement"];tap(replacement)
        let closed=app.switches["Курс завершён"];closed.coordinate(withNormalizedOffset:CGVector(dx:0.92,dy:0.5)).tap()
        let unknown=app.switches["Дата неизвестна"];unknown.coordinate(withNormalizedOffset:CGVector(dx:0.92,dy:0.5)).tap()
        tap(app.buttons["Сохранить даты"])
        app.swipeDown()
        let emptyCourses=app.staticTexts["Сейчас нет активных курсов"]
        for _ in 0..<4 where !emptyCourses.exists {app.swipeUp()}
        XCTAssertTrue(emptyCourses.waitForExistence(timeout:6))
        let original=app.buttons.matching(NSPredicate(format:"label CONTAINS 'Первичный осмотр QA'")).firstMatch
        tap(original)
        let manualMedicine=app.staticTexts["Фикстурин · 5 мг"]
        for _ in 0..<4 where !manualMedicine.exists {app.swipeUp()}
        XCTAssertTrue(manualMedicine.exists)
        let paperMedicine=app.staticTexts["Бланкин · 10 мг"]
        for _ in 0..<5 where !paperMedicine.exists {app.swipeUp()}
        XCTAssertTrue(paperMedicine.exists,app.debugDescription)
        XCTAssertFalse(app.staticTexts["Непроверенный · 2 мг"].exists)
        tap(app.buttons["Добавить пометку"]);let message=app.textFields["Текст пометки"];tap(message);message.typeText("Shared QA note");tap(app.buttons["Сохранить пометку"])
        XCTAssertTrue(app.staticTexts["Shared QA note"].waitForExistence(timeout:6))
        app.swipeDown();tap(app.buttons["Сводка по этому эпизоду"])
        XCTAssertTrue(app.navigationBars["Сводка к приёму"].waitForExistence(timeout:5))
        XCTAssertTrue(app.buttons.matching(NSPredicate(format:"label CONTAINS 'Повторный осмотр QA'")).firstMatch.exists)
        XCTAssertFalse(app.buttons.matching(NSPredicate(format:"label CONTAINS 'Посторонний визит'")).firstMatch.exists)
        tap(app.buttons.matching(NSPredicate(format:"label CONTAINS 'Повторный осмотр QA'")).firstMatch)
        XCTAssertTrue(app.staticTexts["Заменитель · 20 мг"].exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format:"label CONTAINS 'окончание неизвестно'")).firstMatch.exists)
    }
}
