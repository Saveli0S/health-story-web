import XCTest

final class RecordRemovalUI: XCTestCase {
    func testDeletesSelectedRecordsAndKeepsUnrelatedData() {
        continueAfterFailure=false
        let app=XCUIApplication()
        app.launch()
        let key=app.secureTextFields.firstMatch
        XCTAssertTrue(key.waitForExistence(timeout:10))
        key.tap()
        key.typeText("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI")
        app.buttons["Открыть архив"].tap()
        XCTAssertTrue(app.navigationBars["Профиль"].waitForExistence(timeout:10),app.debugDescription)
        let manager=app.buttons["Управление данными"]
        for _ in 0..<4 {if manager.isHittable {break};app.swipeUp()}
        XCTAssertTrue(manager.exists)
        manager.tap()
        let visit=app.buttons["remove-addedVisits-v"]
        XCTAssertTrue(visit.waitForExistence(timeout:8),app.debugDescription)
        visit.tap()
        let cancel=app.buttons["Отмена"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout:5),app.debugDescription)
        cancel.tap()
        XCTAssertTrue(visit.exists)
        visit.tap()
        let confirm=app.buttons["Удалить запись"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout:5),app.debugDescription)
        confirm.tap()
        XCTAssertTrue(visit.waitForNonExistence(timeout:5),app.debugDescription)
        let lab=app.buttons["remove-files-analysis"]
        for _ in 0..<4 {if lab.isHittable {break};app.swipeUp()}
        XCTAssertTrue(lab.exists,app.debugDescription)
        lab.tap()
        XCTAssertTrue(confirm.waitForExistence(timeout:5),app.debugDescription)
        confirm.tap()
        XCTAssertTrue(lab.waitForNonExistence(timeout:5),app.debugDescription)
        XCTAssertTrue(app.buttons["remove-files-intake"].exists)
    }
}
