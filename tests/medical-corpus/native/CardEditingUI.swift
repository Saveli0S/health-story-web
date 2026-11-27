import XCTest

final class CardEditingUI: XCTestCase {
    func testOpenDuplicateAndEditExistingVisit() {
        continueAfterFailure=false
        let app=XCUIApplication()
        app.launch()
        let key=app.secureTextFields.firstMatch
        XCTAssertTrue(key.waitForExistence(timeout:10))
        key.tap()
        key.typeText("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI")
        app.buttons["Открыть архив"].tap()
        app.buttons["Мая Макетова"].tap()
        func enterVisit() {
            app.buttons["Новый визит"].tap()
            for (label,text) in [("Название эпизода","QA episode"),
                                 ("Название визита","QA exact visit"),
                                 ("ФИО врача","Clinician QA")] {
                let field=app.textFields[label]
                XCTAssertTrue(field.waitForExistence(timeout:6))
                if !field.isHittable {app.swipeUp()}
                field.tap();field.typeText(text)
            }
            app.navigationBars.buttons["Сохранить"].tap()
        }
        enterVisit()
        let visit=app.buttons.matching(NSPredicate(format:"label BEGINSWITH 'QA exact visit'")).firstMatch
        XCTAssertTrue(visit.waitForExistence(timeout:6))
        enterVisit()
        let existing=app.buttons["Открыть существующий визит"]
        for _ in 0..<6 {if existing.isHittable {break};app.swipeUp()}
        XCTAssertTrue(existing.exists,app.debugDescription)
        existing.tap()
        app.buttons["Редактировать визит"].tap()
        let title=app.textFields["Название визита"]
        title.tap()
        title.typeText(String(repeating:XCUIKeyboardKey.delete.rawValue,count:"QA exact visit".count)+"QA exact visit edited")
        let details=app.textFields["Сведения о визите"]
        if !details.isHittable {app.swipeUp()}
        details.tap();details.typeText("QA visit details")
        app.navigationBars.buttons["Сохранить изменения"].tap()
        XCTAssertTrue(app.navigationBars["QA exact visit edited"].waitForExistence(timeout:6),app.debugDescription)
    }
}
