import XCTest

final class ConsultationUI: XCTestCase {
    private func openHistory() -> XCUIApplication {
        continueAfterFailure=false
        let app=XCUIApplication()
        app.launch()
        let key=app.secureTextFields.firstMatch
        XCTAssertTrue(key.waitForExistence(timeout:10),app.debugDescription)
        key.tap();key.typeText("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI")
        app.buttons["Открыть архив"].tap()
        XCTAssertTrue(app.navigationBars["Профиль"].waitForExistence(timeout:10),app.debugDescription)
        app.buttons["ИИ-консультация"].tap()
        return app
    }

    func testCompleteWebExamDraft() throws {
        let app=openHistory()
        app.navigationBars.buttons.firstMatch.tap()
        let exams=app.buttons["Результаты обследований"]
        XCTAssertTrue(exams.waitForExistence(timeout:5));exams.tap()
        app.buttons.matching(NSPredicate(format:"label CONTAINS 'Учебная область'")).firstMatch.tap()
        let toggle=app.switches["Сведения сверены с протоколом"]
        for _ in 0..<6 {if toggle.isHittable {break};app.swipeUp()}
        XCTAssertTrue(toggle.exists)
        toggle.coordinate(withNormalizedOffset:CGVector(dx:0.92,dy:0.5)).tap()
        let save=app.buttons["Сохранить обследование"]
        if !save.isHittable {app.swipeUp()}
        save.tap()
        let saved=app.buttons.matching(NSPredicate(format:"label CONTAINS 'Учебная область'")).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout:8));saved.tap()
        XCTAssertTrue(app.staticTexts["ЗАКЛЮЧЕНИЕ ОБСЛЕДОВАНИЯ"].exists)
        XCTAssertTrue(app.buttons["Учебный протокол.txt"].exists)
    }

    func testPreviouslySavedDraftRedaction() throws {
        let app=openHistory()
        app.buttons.matching(NSPredicate(format:"label CONTAINS 'Старый черновик'")).firstMatch.tap()
        let text=app.textViews.firstMatch
        XCTAssertTrue(text.waitForExistence(timeout:5))
        let pending=try XCTUnwrap(text.value as? String)
        XCTAssertFalse(pending.contains("example@example.org"));XCTAssertTrue(pending.contains("[почта скрыта]"))
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons.matching(NSPredicate(format:"label CONTAINS 'История передачи'")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Уже переданный текст · OLD-QA-MARK"].exists)
    }

    func testConsultationFromSyntheticArchive() throws {
        let app=openHistory()
        app.buttons["Новая консультация"].tap()
        let pick=app.switches.matching(NSPredicate(format:"label CONTAINS 'Эпизод QA'")).firstMatch
        for _ in 0..<6 where !pick.isHittable || !app.frame.intersects(pick.frame) {app.swipeUp()}
        for offset in [0.88, 0.85, 0.93] where pick.value as? String != "1" {
            pick.coordinate(withNormalizedOffset:CGVector(dx:offset,dy:0.5)).tap()
        }
        XCTAssertEqual(pick.value as? String,"1",app.debugDescription)
        let question=app.textFields["Что нужно разобрать?"]
        question.tap();question.typeText("Review example@example.org")
        let prepare=app.buttons["Проверить запрос"]
        if !prepare.isHittable {app.swipeUp()}
        prepare.tap()
        let text=app.textViews.firstMatch
        XCTAssertTrue(text.waitForExistence(timeout:8),app.debugDescription)
        let preview=try XCTUnwrap(text.value as? String)
        XCTAssertFalse(preview.contains("example@example.org"))
        for token in ["Глюкоза","120","СТЕНДОВАЯ ПОМЕТКА","ВОПРОС ЭПИЗОДА","ИЗМЕРЕНИЕ ЭПИЗОДА","ПРОВЕРЕННОЕ НАЗНАЧЕНИЕ"] {XCTAssertTrue(preview.contains(token),token+" in "+preview)}
        for token in ["PRIVATE-OTHER-PROFILE","Мая Макетова","НЕСВЕРЕННЫЙ ТЕКСТ"] {XCTAssertFalse(preview.contains(token),token)}
        func reach(_ element:XCUIElement) {
            for attempt in 0..<10 where !element.isHittable || !app.frame.intersects(element.frame) {
                if attempt<6 {app.swipeUp()} else {app.swipeDown()}
            }
            XCTAssertTrue(element.isHittable,app.debugDescription)
        }
        let copy=app.buttons["Скопировать и открыть новый чат"];reach(copy);copy.tap()
        let fallback=app.staticTexts["Запрос скопирован. Если приложение ChatGPT недоступно, откройте веб-версию."]
        reach(fallback)
        reach(app.buttons["Сохранить запрос как TXT"])
        let answer=app.textFields["Вставьте ответ"];reach(answer)
        answer.tap();answer.typeText("Synthetic response for QA")
        let save=app.buttons["Сохранить ответ"];reach(save);save.tap()
        XCTAssertTrue(app.staticTexts["Synthetic response for QA"].waitForExistence(timeout:5))
        let attachment=XCTAttachment(screenshot:app.screenshot());attachment.name="Consultation history";attachment.lifetime = .keepAlways;add(attachment)
    }
}
