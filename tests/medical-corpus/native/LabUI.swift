import XCTest

final class LabUI:XCTestCase {
    let app=XCUIApplication()
    func openLabs(){
        app.launch()
        let key=app.secureTextFields.firstMatch
        if key.waitForExistence(timeout:4){
            key.tap();key.typeText("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI");app.buttons["Открыть архив"].tap()
        }
        app.buttons["Мая Макетова"].tap()
        app.buttons["Анализы и измерения"].tap()
    }
    func reach(_ element:XCUIElement){
        for _ in 0..<12 {if element.exists && element.isHittable {return};app.swipeUp()}
        XCTFail("Недоступен элемент "+element.debugDescription)
    }
    func testStandalone() {
        continueAfterFailure=false
        openLabs()
        app.buttons["Добавить лабораторный бланк"].tap()
        app.buttons["Выбрать фото или PDF из файлов"].tap()
        app.buttons.matching(NSPredicate(format:"label CONTAINS '01-baseline.pdf'")).firstMatch.tap()
        XCTAssertTrue(app.textFields["Дата взятия · ГГГГ-ММ-ДД"].waitForExistence(timeout:20))
        let later=app.buttons["Уточнить позже"];reach(later);later.tap()
        app.terminate();openLabs()
        let pending=app.buttons["01-baseline.pdf"].firstMatch;reach(pending);pending.tap()
        let checked=app.switches["Сверено с оригиналом"];reach(checked);checked.coordinate(withNormalizedOffset:CGVector(dx:0.92,dy:0.5)).tap();XCTAssertEqual(checked.value as? String,"1",app.debugDescription)
        let save=app.buttons["Сохранить результаты"];reach(save);XCTAssertTrue(save.isEnabled,app.debugDescription);save.tap()
        let chart=app.buttons.matching(NSPredicate(format:"label CONTAINS 'Гемоглобин'")).firstMatch
        XCTAssertTrue(chart.waitForExistence(timeout:10));chart.tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format:"label CONTAINS '132'")).firstMatch.exists)
    }
}
