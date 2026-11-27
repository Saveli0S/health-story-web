import XCTest

final class APIKeysUI: XCTestCase {
    private func tap(_ element: XCUIElement, in app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        for attempt in 0..<10 {
            if element.exists, element.isHittable, app.frame.intersects(element.frame) {
                element.tap()
                return
            }
            if attempt < 5 { app.swipeUp() } else { app.swipeDown() }
        }
        XCTFail("Control unavailable: " + element.description, file: file, line: line)
    }

    private func openJournal(_ app: XCUIApplication) {
        let unlock = app.buttons["Открыть архив"]
        if unlock.waitForExistence(timeout: 4) {
            let recovery = app.secureTextFields.firstMatch
            recovery.tap()
            recovery.typeText("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI")
            unlock.tap()
        }
        XCTAssertTrue(app.buttons["Мая Макетова"].waitForExistence(timeout: 10), app.debugDescription)
    }

    func testConnectContinueAndReuseKeys() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        openJournal(app)
        tap(app.buttons["ИИ-провайдеры"], in: app)
        for (label, key) in [("DeepSeek", "synthetic-deepseek-key"), ("Claude (Anthropic)", "synthetic-anthropic-key")] {
            let disconnect = app.buttons["Отключить " + label]
            if disconnect.exists { tap(disconnect, in: app) }
            let field = app.secureTextFields["API-ключ " + label]
            tap(field, in: app)
            field.typeText(key)
            tap(app.buttons["Проверить и подключить " + label], in: app)
            XCTAssertTrue(app.buttons["Отключить " + label].waitForExistence(timeout: 5))
        }
        let defaultPicker = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Провайдер по умолчанию'")).firstMatch
        tap(defaultPicker, in: app)
        tap(app.buttons["Claude (Anthropic)"], in: app)
        app.navigationBars.buttons.firstMatch.tap()
        tap(app.buttons["Мая Макетова"], in: app)
        tap(app.buttons["ИИ-консультация"], in: app)
        let record = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'QA API keys'")).firstMatch
        tap(record, in: app)
        XCTAssertTrue(app.buttons["Подтвердить и отправить в Claude (Anthropic)"].waitForExistence(timeout: 7))
        let picker = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Провайдер,'")).firstMatch
        tap(picker, in: app)
        tap(app.buttons["DeepSeek"], in: app)
        tap(app.buttons["Подтвердить и отправить в DeepSeek"], in: app)
        XCTAssertTrue(app.staticTexts["Да"].waitForExistence(timeout: 7), app.debugDescription)
        app.navigationBars.buttons.firstMatch.tap()
        tap(record, in: app)
        let next = app.descendants(matching: .any)["chatgpt-followup-draft"].firstMatch
        tap(next, in: app)
        next.typeText("Повтори ответ заглавными буквами")
        tap(app.buttons["Подтвердить и отправить в DeepSeek"], in: app)
        XCTAssertTrue(app.staticTexts["ДА"].waitForExistence(timeout: 7), app.debugDescription)
        tap(next, in: app)
        next.typeText("Next control question")
        tap(picker, in: app)
        tap(app.buttons["Claude (Anthropic)"], in: app)
        tap(app.buttons["Подтвердить и отправить в Claude (Anthropic)"], in: app)
        XCTAssertTrue(app.staticTexts["Учебный ответ Claude"].waitForExistence(timeout: 7), app.debugDescription)
        app.terminate()
        app.launch()
        openJournal(app)
        tap(app.buttons["ИИ-провайдеры"], in: app)
        XCTAssertTrue(defaultPicker.label.contains("Claude (Anthropic)"))
        tap(app.buttons["Отключить DeepSeek"], in: app)
        XCTAssertTrue(app.secureTextFields["API-ключ DeepSeek"].exists)
        XCTAssertTrue(app.buttons["Отключить Claude (Anthropic)"].exists)
        tap(app.buttons["Отключить Claude (Anthropic)"], in: app)
    }
}
