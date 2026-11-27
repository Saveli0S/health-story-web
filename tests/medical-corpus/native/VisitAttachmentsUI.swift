import XCTest

final class VisitAttachmentsUI:XCTestCase {
    func testExistingVisitCanReceiveAndReviewAnOriginal() {
        continueAfterFailure=false
        let app=XCUIApplication();app.launch()
        func tap(_ control:XCUIElement,file:StaticString=#filePath,line:UInt=#line){
            for step in 0..<12 {
                if control.exists,control.isHittable,app.frame.intersects(control.frame){control.tap();return}
                if step<6 {app.swipeUp()} else {app.swipeDown()}
            }
            XCTFail("Control unavailable: "+control.description,file:file,line:line)
        }
        let key=app.secureTextFields.firstMatch
        XCTAssertTrue(key.waitForExistence(timeout:15));key.tap()
        key.typeText("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI")
        tap(app.buttons["Открыть архив"]);tap(app.buttons["Мая Макетова"])
        tap(app.buttons.matching(NSPredicate(format:"label CONTAINS 'Осмотр QA'")).firstMatch)
        tap(app.buttons["Прикрепить фото, PDF или другой файл"])
        tap(app.buttons["Выбрать файлы"]);tap(app.buttons["Прикрепить к визиту"])
        tap(app.buttons["Сверить сведения · Рекомендации QA.txt"])
        tap(app.buttons["Распознать на iPhone"])
        XCTAssertTrue(app.buttons["Распознать на iPhone"].waitForExistence(timeout:10))
        let check=app.switches["Сверено с оригиналом"]
        for _ in 0..<5 where !check.isHittable {app.swipeUp()}
        for x in [0.88,0.85,0.93] where check.value as? String != "1" {
            check.coordinate(withNormalizedOffset:CGVector(dx:x,dy:0.5)).tap()
        }
        XCTAssertEqual(check.value as? String,"1",app.debugDescription)
        tap(app.buttons["Сохранить сведения"])
        XCTAssertTrue(app.navigationBars["Вложения визита"].waitForExistence(timeout:8))
    }
}
