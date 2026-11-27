import XCTest

final class ArchiveUnlockUI:XCTestCase {
    func testRememberReopenForgetAndUseManualKey() {
        continueAfterFailure=false
        let app=XCUIApplication()
        let syntheticKey="QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI"
        let quick=app.buttons["Открыть через Face ID или код iPhone"]
        let option=app.switches["Запомнить ключ на этом iPhone"]
        let input=app.secureTextFields["Семейный ключ восстановления"]

        func enterKey(){
            XCTAssertTrue(input.waitForExistence(timeout:15))
            input.tap();input.typeText(syntheticKey)
            app.buttons["Открыть архив"].tap()
            XCTAssertTrue(app.buttons["Мая Макетова"].waitForExistence(timeout:12),app.debugDescription)
        }

        app.launch()
        XCTAssertTrue(option.waitForExistence(timeout:15))
        XCTAssertFalse(quick.exists)
        XCTAssertEqual(option.value as? String,"0")
        for offset in [0.88,0.85,0.93] where option.value as? String != "1" {
            option.coordinate(withNormalizedOffset:CGVector(dx:offset,dy:0.5)).tap()
        }
        XCTAssertEqual(option.value as? String,"1")
        enterKey()
        app.terminate();app.launch()
        XCTAssertTrue(quick.waitForExistence(timeout:12))
        quick.tap()
        XCTAssertTrue(app.buttons["Мая Макетова"].waitForExistence(timeout:12),app.debugDescription)
        app.buttons["Закрыть архив"].tap()
        let forget=app.buttons["Забыть ключ на этом iPhone"]
        XCTAssertTrue(forget.waitForExistence(timeout:10));forget.tap()
        XCTAssertTrue(quick.waitForNonExistence(timeout:5))
        enterKey()
        app.buttons["Закрыть архив"].tap()
        XCTAssertTrue(option.waitForExistence(timeout:10))
        XCTAssertEqual(option.value as? String,"0")
    }
}
