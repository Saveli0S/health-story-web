import XCTest

final class LayoutUI: XCTestCase {
    func inspect(_ size:String) {
        continueAfterFailure=false
        let app=XCUIApplication()
        app.launchArguments+=["-UIPreferredContentSizeCategoryName",size]
        app.launch()
        func tap(_ control:XCUIElement,screenshot:String?=nil,file:StaticString=#filePath,line:UInt=#line){
            for step in 0..<12 {
                if control.exists,control.isHittable,app.frame.intersects(control.frame){
                    if let screenshot {capture(screenshot)}
                    control.tap()
                    return
                }
                if step<6 {app.swipeUp()} else {app.swipeDown()}
            }
            XCTFail("Missing control: "+control.description+" "+app.debugDescription,file:file,line:line)
        }
        func capture(_ title:String){
            let shot=XCTAttachment(screenshot:app.screenshot())
            shot.name=title
            shot.lifetime = .keepAlways
            add(shot)
        }
        func named(_ title:String)->XCUIElement{
            app.buttons.matching(NSPredicate(format:"label CONTAINS %@",title)).firstMatch
        }
        let key=app.secureTextFields.firstMatch
        XCTAssertTrue(key.waitForExistence(timeout:15))
        tap(key);key.typeText("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI")
        tap(named("Открыть архив"))
        XCTAssertTrue(app.navigationBars["Профиль"].waitForExistence(timeout:10),app.debugDescription)
        XCTAssertTrue(app.navigationBars["Профиль"].buttons["Моя семья"].isHittable)
        let search=app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout:8))
        XCTAssertLessThan(search.frame.maxY,app.frame.height*0.45,
                          "The search field must stay above records.")
        capture("Profile")
        tap(named("Осмотр QA"),screenshot:"Visit card date")
        capture("Visit")
        tap(named("Сводка по этому эпизоду"))
        capture("Brief")
    }
    func testStandardLayout(){inspect("UICTContentSizeCategoryL")}
    func testAccessibilityLayout(){inspect("UICTContentSizeCategoryAccessibilityM")}

    func testPersonalProfileIsHome() {
        continueAfterFailure=false
        let app=XCUIApplication()
        let profile=app.navigationBars["Профиль"]
        let family=profile.buttons["Моя семья"]
        let other=app.buttons["Другой профиль"]

        func openArchive() {
            let key=app.secureTextFields.firstMatch
            XCTAssertTrue(key.waitForExistence(timeout:10))
            key.tap()
            key.typeText("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI")
            app.buttons["Открыть архив"].tap()
            XCTAssertTrue(profile.waitForExistence(timeout:10))
            XCTAssertTrue(app.staticTexts["Мая Макетова"].exists)
            XCTAssertTrue(family.isHittable)
            XCTAssertFalse(other.exists)
        }

        app.launch()
        openArchive()
        app.buttons.matching(NSPredicate(format:"label CONTAINS 'Осмотр QA'")).firstMatch.tap()
        let visit=app.navigationBars["Приём"]
        XCTAssertTrue(visit.waitForExistence(timeout:6))
        visit.buttons.firstMatch.tap()
        XCTAssertTrue(family.waitForExistence(timeout:6))
        family.tap()
        XCTAssertTrue(other.waitForExistence(timeout:6))
        other.tap()
        XCTAssertTrue(app.staticTexts["Другой профиль"].waitForExistence(timeout:6))
        profile.buttons.firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Мая Макетова"].waitForExistence(timeout:6))
        XCTAssertTrue(family.isHittable)
        family.tap()
        app.navigationBars["Моя семья"].buttons["Закрыть"].tap()
        XCTAssertTrue(family.waitForExistence(timeout:6))
        app.terminate()
        app.launch()
        openArchive()
    }
}
