import XCTest

final class LayoutUI: XCTestCase {
    func inspect(_ size:String) {
        continueAfterFailure=false
        let app=XCUIApplication()
        app.launchArguments+=["-UIPreferredContentSizeCategoryName",size]
        app.launch()
        func tap(_ control:XCUIElement,file:StaticString=#filePath,line:UInt=#line){
            for step in 0..<12 {
                if control.exists,control.isHittable,app.frame.intersects(control.frame){control.tap();return}
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
        tap(named("Мая Макетова"))
        let search=app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout:8))
        XCTAssertLessThan(search.frame.maxY,app.frame.height*0.45,
                          "The search field must stay above records.")
        capture("Profile")
        tap(named("Осмотр QA"))
        capture("Visit")
        tap(named("Сводка по этому эпизоду"))
        capture("Brief")
    }
    func testStandardLayout(){inspect("UICTContentSizeCategoryL")}
    func testAccessibilityLayout(){inspect("UICTContentSizeCategoryAccessibilityM")}
}
