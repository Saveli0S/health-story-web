import XCTest

final class PharmacyLiveUI: XCTestCase {
    func testPublicPricesForMinskAndBelarus() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()

        let key = app.secureTextFields.firstMatch
        XCTAssertTrue(key.waitForExistence(timeout: 10))
        key.tap()
        key.typeText("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI")
        app.buttons["Открыть архив"].tap()
        let profile = app.buttons["Мая Макетова"]
        XCTAssertTrue(profile.waitForExistence(timeout: 10))
        profile.tap()
        app.buttons.containing(NSPredicate(format: "label BEGINSWITH 'Осмотр QA'")).firstMatch.tap()
        let treatment = app.buttons["Разбор лечения и цены лекарств"]
        for _ in 0..<5 where !treatment.isHittable { app.swipeUp() }
        XCTAssertTrue(treatment.isHittable, app.debugDescription)
        treatment.tap()
        let market = app.buttons["Аналоги и цены"].firstMatch
        for _ in 0..<5 where !market.isHittable { app.swipeUp() }
        XCTAssertTrue(market.isHittable)
        market.tap()

        let minsk = app.buttons["Проверить цены · Минск"]
        for _ in 0..<5 where !minsk.isHittable { app.swipeUp() }
        XCTAssertTrue(minsk.isHittable)
        minsk.tap()
        let minskStatus = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Минск · '")).firstMatch
        reachResult(minskStatus, in: app)

        let item = app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'таблетки 500мг N20' AND label CONTAINS 'Борисовский'")).firstMatch
        for _ in 0..<10 where !item.isHittable { app.swipeUp() }
        XCTAssertTrue(item.isHittable, app.debugDescription)
        let row = app.cells.containing(.staticText, identifier: item.label).firstMatch
        let showItemPrice = row.buttons["Посмотреть цену этой упаковки"]
        if !showItemPrice.isHittable { app.swipeUp() }
        XCTAssertTrue(showItemPrice.isHittable, app.debugDescription)
        showItemPrice.tap()
        let price = app.staticTexts.containing(NSPredicate(format: "label MATCHES %@", "[0-9]+[.,][0-9]{2} – [0-9]+[.,][0-9]{2} BYN")).firstMatch
        XCTAssertTrue(price.waitForExistence(timeout: 5), app.debugDescription)

        let nationwide = app.buttons["Искать по всей Беларуси"]
        for _ in 0..<10 where !nationwide.isHittable { app.swipeDown() }
        XCTAssertTrue(nationwide.isHittable)
        nationwide.tap()
        let countryStatus = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Вся Беларусь · '")).firstMatch
        reachResult(countryStatus, in: app)
    }

    private func reachResult(_ status: XCUIElement, in app: XCUIApplication) {
        let busy = app.staticTexts["Проверяем цены…"]
        XCTAssertTrue(busy.waitForNonExistence(timeout: 25))
        for _ in 0..<4 where !status.isHittable { app.swipeUp() }
        XCTAssertTrue(status.isHittable, app.debugDescription)
    }
}
