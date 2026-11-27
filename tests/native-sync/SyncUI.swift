import XCTest

final class SyncUI:XCTestCase {
    func testConflictAndOfflineEpisode() throws {
        let app=XCUIApplication();app.launch()
        continueAfterFailure=false
        app.buttons["Ребёнок QA"].tap()
        let field=app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout:6))
        for (term,found) in [("Курсограм",true),("Пометкасверки",true),("Лесов",true),("Скрытыймаркер",false)] {
            field.tap();field.typeText(term)
            let hit=app.buttons.matching(NSPredicate(format:"label CONTAINS 'Осмотр'")).firstMatch
            if found {XCTAssertTrue(hit.waitForExistence(timeout:5),app.debugDescription)}
            else {XCTAssertTrue(app.staticTexts["По этому запросу визитов нет"].waitForExistence(timeout:5),app.debugDescription)}
            let cancel=app.buttons.matching(NSPredicate(format:"label IN {'Cancel','Отменить','Отмена'}")).firstMatch
            if cancel.exists {cancel.tap()}
            else {field.typeText(String(repeating:XCUIKeyboardKey.delete.rawValue,count:term.count))}
        }
        let conflicts=app.buttons.matching(NSPredicate(format:"label BEGINSWITH 'Расхождения'")).firstMatch
        if !conflicts.isHittable {app.swipeUp()}
        conflicts.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format:"label CONTAINS 'Автор офлайн'")).firstMatch.exists)
        app.buttons["Выбрать это значение"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Все расхождения разрешены."].waitForExistence(timeout:12),app.debugDescription)
        app.navigationBars.buttons.firstMatch.tap()
        let offline=app.buttons["Оригиналы без сети"]
        if !offline.isHittable {app.swipeUp()};offline.tap()
        let group=app.buttons["Эпизод"]
        XCTAssertTrue(group.waitForExistence(timeout:5),app.debugDescription)
        group.tap()
        XCTAssertTrue(app.staticTexts["Доступно без сети · 2"].waitForExistence(timeout:12),app.debugDescription)
        app.terminate()
        app.launchArguments=["--offline"];app.launch()
        app.buttons["Ребёнок QA"].tap();if !offline.isHittable {app.swipeUp()};offline.tap()
        app.buttons["Заключение.txt"].tap()
        XCTAssertTrue(app.staticTexts["Сверенное заключение QA"].waitForExistence(timeout:6),app.debugDescription)
        let shot=XCTAttachment(screenshot:app.screenshot());shot.name="Offline original after restart";shot.lifetime = .keepAlways;add(shot)
    }
}
