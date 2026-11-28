import XCTest

final class ProviderReviewUI:XCTestCase {
    func testConfirmedTreatmentReviewCanRetry() {
        continueAfterFailure=false
        let app=XCUIApplication();app.launch()
        func tap(_ element:XCUIElement,file:StaticString=#filePath,line:UInt=#line){
            for attempt in 0..<10 {
                if element.exists,element.isHittable,app.frame.intersects(element.frame){element.tap();return}
                if attempt<5 {app.swipeUp()} else {app.swipeDown()}
            }
            XCTFail("Control unavailable: "+element.description,file:file,line:line)
        }
        let key=app.secureTextFields.firstMatch
        XCTAssertTrue(key.waitForExistence(timeout:15));key.tap()
        key.typeText("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI")
        tap(app.buttons["Открыть архив"])
        XCTAssertTrue(app.navigationBars["Профиль"].waitForExistence(timeout:10),app.debugDescription)
        tap(app.buttons.matching(NSPredicate(format:"label CONTAINS 'Синтетический осмотр'")).firstMatch)
        tap(app.buttons["Разбор лечения и цены лекарств"])
        tap(app.buttons["Разобрать лечение в ChatGPT"])
        let preview=app.textViews["review-exact-prompt"]
        XCTAssertTrue(preview.waitForExistence(timeout:12))
        XCTAssertTrue((preview.value as? String)?.contains("TEST-CLAIM")==true)
        tap(app.buttons["Подтвердить и отправить"])
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format:"label CONTAINS 'Квота ChatGPT исчерпана'")).firstMatch.waitForExistence(timeout:12))
        tap(app.buttons["Закрыть"])
        tap(app.buttons["Разобрать лечение в ChatGPT"])
        XCTAssertTrue(preview.waitForExistence(timeout:12))
        XCTAssertTrue((preview.value as? String)?.contains("TEST-CLAIM")==true)
        tap(app.buttons["Подтвердить и отправить"])
        tap(app.buttons.matching(NSPredicate(format:"label CONTAINS 'Последний разбор'")).firstMatch)
        XCTAssertTrue(app.staticTexts["Недостаточно данных для оценки"].waitForExistence(timeout:12))
    }
}
