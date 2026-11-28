import XCTest

final class LabUI:XCTestCase {
    let app=XCUIApplication()
    func openLabs(){
        app.launch()
        let key=app.secureTextFields.firstMatch
        if key.waitForExistence(timeout:4){
            key.tap();key.typeText("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI");app.buttons["Открыть архив"].tap()
        }
        XCTAssertTrue(app.navigationBars["Профиль"].waitForExistence(timeout:10),app.debugDescription)
        app.buttons["Анализы и измерения"].tap()
    }
    func reach(_ element:XCUIElement){
        for _ in 0..<12 {if element.exists && element.isHittable {return};app.swipeUp()}
        XCTFail("Недоступен элемент "+element.debugDescription)
    }
    func testRepeatedIndicators() {
        continueAfterFailure=false
        openLabs()
        let search=app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout:10));search.tap();search.typeText("HDL")
        let matches=app.buttons.matching(NSPredicate(format:"label CONTAINS 'Холестерин ЛПВП'"))
        XCTAssertTrue(matches.firstMatch.waitForExistence(timeout:10))
        XCTAssertEqual(matches.count,1)
        XCTAssertTrue(matches.firstMatch.label.contains("Результатов: 3"))
        matches.firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Холестерин ЛПВП"].waitForExistence(timeout:10))
        for date in ["2022-01-11","2023-02-12","2024-03-13"] {
            let selector=app.buttons.matching(NSPredicate(format:"label CONTAINS 'Ряд для сравнения'")).firstMatch
            reach(selector);selector.tap()
            let option=date=="2024-03-13" ? "Сыворотка":date
            app.buttons.matching(NSPredicate(format:"label CONTAINS %@",option)).firstMatch.tap()
            let result=app.buttons.matching(NSPredicate(format:"label BEGINSWITH %@",date)).firstMatch
            reach(result)
            XCTAssertTrue(result.exists)
            if date=="2022-01-11" {XCTAssertTrue(result.label.contains("Дата по бланку"))}
        }
    }
    func testStandalone() {
        continueAfterFailure=false
        openLabs()
        app.buttons["Добавить лабораторный бланк"].tap()
        app.buttons["Выбрать фото или PDF из файлов"].tap()
        let imported=app.buttons.matching(NSPredicate(format:"label CONTAINS '01-baseline.pdf'")).firstMatch
        XCTAssertTrue(imported.waitForExistence(timeout:20))
        let ready=XCTNSPredicateExpectation(predicate:NSPredicate(format:"enabled == true"),object:imported)
        XCTAssertEqual(XCTWaiter.wait(for:[ready],timeout:20),.completed)
        imported.tap()
        XCTAssertTrue(app.descendants(matching:.any).matching(identifier:"journal-calendar-Дата взятия образца").firstMatch.waitForExistence(timeout:20))
        let later=app.buttons["Уточнить позже"];reach(later);later.tap()
        app.terminate();openLabs()
        let pending=app.buttons["01-baseline.pdf"].firstMatch;reach(pending);pending.tap()
        let checked=app.switches["Сверено с оригиналом"];reach(checked);checked.coordinate(withNormalizedOffset:CGVector(dx:0.92,dy:0.5)).tap();XCTAssertEqual(checked.value as? String,"1",app.debugDescription)
        let save=app.buttons["Сохранить результаты"];reach(save);XCTAssertTrue(save.isEnabled,app.debugDescription);save.tap()
        let chart=app.buttons.matching(NSPredicate(format:"label CONTAINS 'Гемоглобин'")).firstMatch
        XCTAssertTrue(chart.waitForExistence(timeout:10));chart.tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format:"label CONTAINS '132'")).firstMatch.exists)
        app.navigationBars.buttons.firstMatch.tap()
        app.navigationBars.buttons.firstMatch.tap()
        let search=app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout:10));search.tap();search.typeText("HGB")
        let hit=app.buttons.matching(NSPredicate(format:"label CONTAINS 'Гемоглобин'")).firstMatch
        XCTAssertTrue(hit.waitForExistence(timeout:10));hit.tap()
        XCTAssertTrue(app.navigationBars["Гемоглобин"].waitForExistence(timeout:10))
        XCTAssertTrue(app.buttons.matching(NSPredicate(format:"label CONTAINS '2025-01-08' AND label CONTAINS '132'")).firstMatch.exists)
    }
}
