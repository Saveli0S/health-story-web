import XCTest

final class ChatGPTUI: XCTestCase {
    private func openHistory(_ app: XCUIApplication) {
        let key=app.secureTextFields.firstMatch
        if key.waitForExistence(timeout:4) {
            key.tap()
            key.typeText("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI")
            app.buttons["Открыть архив"].tap()
        }
        XCTAssertTrue(app.navigationBars["Профиль"].waitForExistence(timeout:10),app.debugDescription)
        let history=app.buttons["ИИ-консультация"]
        for _ in 0..<4 where !history.isHittable {app.swipeUp()}
        XCTAssertTrue(history.isHittable,app.debugDescription)
        history.tap()
    }

    func testQuotaRetryAndSavedConversation() {
        continueAfterFailure=false
        let app=XCUIApplication()
        app.launch()
        openHistory(app)
        let record=app.buttons.matching(NSPredicate(format:"label BEGINSWITH 'QA ChatGPT'")).firstMatch
        record.tap()
        let prompt=app.textViews.firstMatch
        XCTAssertTrue(prompt.waitForExistence(timeout:8))
        XCTAssertEqual(prompt.value as? String,"First fixture question")
        let send=app.buttons["Подтвердить и отправить в ChatGPT"]
        if !send.isHittable {app.swipeUp()}
        send.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format:"label BEGINSWITH 'Первый учебный ответ'")).firstMatch.waitForExistence(timeout:7),app.debugDescription)
        let next=app.descendants(matching:.any)["chatgpt-followup-draft"]
        if !next.isHittable {app.swipeUp()}
        next.tap()
        next.typeText("QA follow up")
        if !send.isHittable {app.swipeUp()}
        send.tap()
        XCTAssertTrue(app.staticTexts["Квота ChatGPT исчерпана. Вопрос сохранён."].waitForExistence(timeout:7),app.debugDescription)
        app.navigationBars.buttons.firstMatch.tap()
        record.tap()
        if !next.isHittable {app.swipeUp()}
        XCTAssertEqual(next.value as? String,"QA follow up")
        if !send.isHittable {app.swipeUp()}
        send.tap()
        XCTAssertTrue(app.staticTexts["Второй учебный ответ"].waitForExistence(timeout:7))
        app.terminate()
        app.launch()
        openHistory(app)
        record.tap()
        if !app.staticTexts["Второй учебный ответ"].isHittable {app.swipeUp()}
        XCTAssertTrue(app.staticTexts["Второй учебный ответ"].exists)
    }
}
