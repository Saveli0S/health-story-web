import XCTest

final class ParityUI: XCTestCase {
    let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
        app.launch()
        let key = app.secureTextFields.firstMatch
        XCTAssertTrue(key.waitForExistence(timeout: 12))
        tap(key)
        key.typeText("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI")
        tap(app.buttons["Открыть архив"])
        XCTAssertTrue(app.navigationBars["Профиль"].waitForExistence(timeout:10),app.debugDescription)
    }

    private func tap(_ target: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        for _ in 0..<10 {
            if target.isHittable { target.tap(); return }
            let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0.78, dy: 0.30))
            let bottom = app.coordinate(withNormalizedOffset: CGVector(dx: 0.78, dy: 0.53))
            if target.exists && target.frame.midY < app.frame.height * 0.25 {
                top.press(forDuration: 0.05, thenDragTo: bottom)
            } else { bottom.press(forDuration: 0.05, thenDragTo: top) }
        }
        XCTFail("Control unavailable: \(target) \(app.debugDescription)", file: file, line: line)
    }

    private func button(containing title: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
    }

    func testEpisodeHistoryAndPrefilledConsultation() {
        tap(app.buttons["История визитов"])
        XCTAssertTrue(app.navigationBars["История"].waitForExistence(timeout: 6))
        tap(app.buttons["По эпизодам"])
        tap(button(containing: "Эпизод QA"))
        XCTAssertTrue(app.navigationBars["Сводка к приёму"].waitForExistence(timeout: 6))
        tap(app.buttons["Обсудить с ИИ"])
        XCTAssertTrue(app.navigationBars["Новая консультация"].waitForExistence(timeout: 6))
        XCTAssertTrue(app.staticTexts["Данные профиля · выбрано 1"].exists, app.debugDescription)
    }

    func testLinkedLabAndOriginalFieldsSwitch() {
        tap(button(containing: "Повторный визит QA"))
        tap(app.buttons["Связанные записи"])
        let lab = app.switches.matching(NSPredicate(format: "label CONTAINS %@", "Анализ крови")).firstMatch
        XCTAssertTrue(lab.waitForExistence(timeout: 6))
        lab.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        tap(app.buttons["Сохранить связи"])
        tap(button(containing: "Анализ крови"))
        XCTAssertTrue(app.navigationBars["Анализ крови"].waitForExistence(timeout: 6))
        tap(app.buttons["Исправить результаты"])
        XCTAssertTrue(app.navigationBars["Сверка бланка"].waitForExistence(timeout: 6))
        tap(app.buttons["Оригинал"])
        XCTAssertTrue(app.staticTexts["QA SOURCE PREVIEW"].waitForExistence(timeout: 6), app.debugDescription)
        tap(app.buttons["Поля"])
        XCTAssertTrue(app.textFields["Название"].waitForExistence(timeout: 6))
        XCTAssertEqual(app.textFields["Название"].value as? String, "Анализ крови")
    }

    func testPDFPageIsSavedWithDeferredReview() {
        tap(app.buttons["Анализы и измерения"])
        tap(app.buttons["Многостраничный бланк QA.pdf"])
        tap(app.buttons["Оригинал"])
        let bottom = app.coordinate(withNormalizedOffset: CGVector(dx: 0.55, dy: 0.82))
        let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0.55, dy: 0.30))
        for _ in 0..<3 { bottom.press(forDuration: 0.05, thenDragTo: top) }
        tap(app.buttons["Поля"])
        tap(app.buttons["Уточнить позже"])
        XCTAssertTrue(app.navigationBars["Анализы и измерения"].waitForExistence(timeout: 6))
    }

    func testTherapyContinuesPreviousPrescription() {
        tap(button(containing: "Повторный визит QA"))
        tap(app.buttons["Решения по предыдущей схеме"])
        XCTAssertTrue(app.navigationBars["Решения по предыдущей схеме"].waitForExistence(timeout: 6))
        tap(app.buttons.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "Без решения", "Решение")).firstMatch)
        tap(app.buttons["Продолжить"])
        tap(app.buttons["Сохранить решения"])
        XCTAssertTrue(app.navigationBars["Приём"].waitForExistence(timeout: 6))
    }

}
