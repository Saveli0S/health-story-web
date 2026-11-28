import XCTest

final class ReviewUI:XCTestCase {
    func testReview() throws {
        continueAfterFailure=false
        let app=XCUIApplication();app.launch()
        func tap(_ e:XCUIElement,file:StaticString=#filePath,line:UInt=#line){
            for attempt in 0..<10 {
                if e.exists,e.isHittable,app.frame.intersects(e.frame){e.tap();return}
                if attempt<5 {app.swipeUp()} else {app.swipeDown()}
            }
            XCTFail("Control unavailable: "+e.description+" "+app.debugDescription,file:file,line:line)
        }
        let key=app.secureTextFields.firstMatch;XCTAssertTrue(key.waitForExistence(timeout:15));key.tap()
        key.typeText("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI")
        tap(app.buttons["Открыть архив"])
        XCTAssertTrue(app.navigationBars["Профиль"].waitForExistence(timeout:10),app.debugDescription)
        tap(app.buttons.matching(NSPredicate(format:"label CONTAINS 'Синтетический осмотр'")).firstMatch)
        tap(app.buttons["Разбор лечения и цены лекарств"])
        tap(app.buttons["Разобрать лечение в ChatGPT"])
        let preview=app.textViews["review-exact-prompt"]
        XCTAssertTrue(preview.waitForExistence(timeout:10),app.debugDescription)
        XCTAssertTrue((preview.value as? String)?.contains("TEST-CLAIM")==true)
        XCTAssertFalse((preview.value as? String)?.contains("Private-filename.pdf")==true)
        tap(app.buttons["Скопировать запрос"]);tap(app.buttons["Подтвердить и скопировать"])
        let answer=app.descendants(matching:.any).matching(identifier:"review-pasted-answer").firstMatch
        tap(answer);answer.typeText("Synthetic answer");tap(app.buttons["Сохранить версию разбора"])
        tap(app.buttons.matching(NSPredicate(format:"label CONTAINS 'Последний разбор'")).firstMatch)
        XCTAssertTrue(app.staticTexts["Недостаточно данных для оценки"].waitForExistence(timeout:8))
    }
}
