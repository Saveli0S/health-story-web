import XCTest

final class ValidationUI: XCTestCase {
    let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
        app.launch()
        let key = app.secureTextFields.firstMatch
        if key.waitForExistence(timeout: 5) {
            key.tap()
            key.typeText("QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI")
            app.buttons["Открыть архив"].tap()
        }
        XCTAssertTrue(app.navigationBars["Профиль"].waitForExistence(timeout:10),app.debugDescription)
    }

    private func reach(_ element: XCUIElement) {
        for _ in 0..<10 {
            if element.isHittable { return }
            let frame = app.frame
            let keyboard = app.keyboards.firstMatch
            let bottom = keyboard.exists ? min(0.53, (keyboard.frame.minY - frame.minY - 30) / frame.height) : 0.76
            let upper = app.coordinate(withNormalizedOffset: CGVector(dx: 0.82, dy: 0.29))
            let lower = app.coordinate(withNormalizedOffset: CGVector(dx: 0.82, dy: bottom))
            if element.exists && element.frame.midY < frame.minY + 0.22 * frame.height {
                upper.press(forDuration: 0.05, thenDragTo: lower)
            } else {
                lower.press(forDuration: 0.05, thenDragTo: upper)
            }
        }
        XCTFail("Недоступен элемент \(element)")
    }

    private func enter(_ field: XCUIElement, _ value: String) {
        XCTAssertTrue(field.isHittable)
        field.tap()
        field.typeText(value)
    }

    private func assertCleared(_ error: XCUIElement) {
        XCTAssertTrue(error.waitForNonExistence(timeout: 3))
    }

    private func capture(_ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name
        image.lifetime = .keepAlways
        add(image)
    }

    func testVisitErrorsClearIndependently() {
        app.buttons["Новый визит"].tap()
        let save = app.navigationBars.buttons["Сохранить"]
        XCTAssertTrue(save.waitForExistence(timeout: 6))
        let episodeError = app.staticTexts["validation-episode-name"]
        let titleError = app.staticTexts["validation-visit-title"]
        let doctorError = app.staticTexts["validation-doctor"]
        XCTAssertFalse(episodeError.exists)
        let addMedicine = app.buttons["Добавить лекарство"]
        reach(addMedicine)
        addMedicine.tap()
        save.tap()
        XCTAssertTrue(episodeError.waitForExistence(timeout: 4))
        XCTAssertTrue(episodeError.isHittable, "После сохранения форма должна показать первую ошибку.")
        XCTAssertTrue(titleError.exists)
        XCTAssertTrue(doctorError.exists)
        let episode = app.textFields["Название эпизода"]
        let title = app.textFields["Название визита"]
        XCTAssertGreaterThan(episodeError.frame.minY, episode.frame.midY)
        XCTAssertLessThan(episodeError.frame.midY, title.frame.minY)
        capture("Visit errors before correction")
        enter(episode, "Validation episode")
        assertCleared(episodeError)
        XCTAssertTrue(titleError.exists)
        capture("Visit after correcting only the episode")
        enter(title, "Validation visit")
        assertCleared(titleError)
        XCTAssertTrue(doctorError.exists)
        let doctor = app.textFields["ФИО врача"]
        reach(doctor)
        enter(doctor, "QA Clinician")
        assertCleared(doctorError)

        let name = app.textFields["Лекарство"]
        reach(name)
        let strengthError = app.staticTexts["Уточните дозировку."]
        let scheduleError = app.staticTexts["Уточните схему приёма."]
        XCTAssertTrue(strengthError.exists)
        enter(name, "QA medicine")
        let strength = app.textFields["Дозировка"]
        reach(strength)
        enter(strength, "?")
        XCTAssertTrue(strengthError.exists)
        strength.typeText(XCUIKeyboardKey.delete.rawValue + "5 mg")
        assertCleared(strengthError)
        XCTAssertTrue(scheduleError.exists)
        let schedule = app.textFields["Схема приёма"]
        reach(schedule)
        enter(schedule, "Once daily")
        assertCleared(scheduleError)
        save.tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Validation visit'")).firstMatch.waitForExistence(timeout: 6))
    }

    func testLabRowAndConfirmationClearIndependently() {
        app.buttons["Анализы и измерения"].tap()
        let draft = app.buttons["Бланк для проверки.txt"]
        reach(draft)
        draft.tap()
        let save = app.buttons["Сохранить результаты"]
        reach(save)
        save.tap()
        let unit = app.textFields["Единица"]
        let unitError = app.staticTexts["Укажите единицу измерения."]
        let rangeError = app.staticTexts["Уточните референсный диапазон по оригиналу."]
        let reviewError = app.staticTexts["validation-lab-review"]
        XCTAssertTrue(unitError.waitForExistence(timeout: 4))
        XCTAssertGreaterThan(unitError.frame.minY, unit.frame.midY)
        XCTAssertTrue(rangeError.exists)
        enter(unit, "mg")
        assertCleared(unitError)
        XCTAssertTrue(rangeError.exists)
        let range = app.textFields["Референсный диапазон"]
        reach(range)
        enter(range, XCUIKeyboardKey.delete.rawValue + "10-20")
        assertCleared(rangeError)
        let checked = app.switches["Сверено с оригиналом"]
        reach(checked)
        XCTAssertTrue(reviewError.exists)
        checked.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        assertCleared(reviewError)
        reach(save)
        save.tap()
        XCTAssertTrue(app.navigationBars["Анализы и измерения"].waitForExistence(timeout: 6))
    }

    func testMeasurementRequiresNumberAndUnit() {
        let clinical=app.buttons["Анализы и измерения"]
        reach(clinical);clinical.tap()
        app.buttons["Добавить измерение"].tap()
        let save = app.buttons["Сохранить измерение"]
        reach(save)
        save.tap()
        let nameError = app.staticTexts["validation-measurement-name"]
        let valueError = app.staticTexts["validation-measurement-value"]
        let unitError = app.staticTexts["validation-measurement-unit"]
        XCTAssertTrue(nameError.waitForExistence(timeout: 4))
        XCTAssertTrue(valueError.exists)
        XCTAssertTrue(unitError.exists)
        enter(app.textFields["Показатель"], "Validation measurement")
        assertCleared(nameError)
        XCTAssertTrue(valueError.exists)
        let value = app.textFields["Значение"]
        enter(value, "37,2")
        assertCleared(valueError)
        XCTAssertTrue(unitError.exists)
        enter(app.textFields["Единица"], "C")
        assertCleared(unitError)
        reach(save)
        save.tap()
        XCTAssertTrue(app.navigationBars["Анализы и измерения"].waitForExistence(timeout: 6))
    }

    func testManualVisitSurvivesClosingWithoutOriginal() {
        app.buttons["Новый визит"].tap()
        let title=app.textFields["Название визита"]
        XCTAssertTrue(title.waitForExistence(timeout:6))
        enter(title,"Manual draft QA")
        app.navigationBars.buttons["Закрыть"].tap()
        let draft=app.buttons["Manual draft QA"]
        reach(draft)
        app.terminate()
        setUp()
        reach(draft);draft.tap()
        XCTAssertEqual(title.value as? String,"Manual draft QA")
        app.navigationBars.buttons["Закрыть"].tap()
    }

    func testExamDateAndParameterFields() {
        let exams = app.buttons["Результаты обследований"]
        reach(exams)
        exams.tap()
        app.buttons["Добавить обследование"].tap()
        let date = app.descendants(matching:.any).matching(identifier:"journal-calendar-Дата обследования").firstMatch
        reach(date)
        let add = app.buttons["Добавить параметр"]
        reach(add)
        add.tap()
        let save = app.buttons["Сохранить обследование"]
        reach(save)
        save.tap()
        let methodError = app.staticTexts["validation-exam-method"]
        XCTAssertTrue(methodError.waitForExistence(timeout: 4))
        XCTAssertTrue(methodError.isHittable)
        let method=app.buttons.matching(NSPredicate(format:"label CONTAINS 'Вид обследования'")).firstMatch
        reach(method);method.tap()
        app.buttons["Другое"].firstMatch.tap()
        enter(app.textFields["Название вида обследования"], "Validation exam")
        assertCleared(methodError)
        let parameter = app.textFields["Название"]
        let parameterError = app.staticTexts["Введите название параметра."]
        let valueError = app.staticTexts["Введите значение параметра."]
        reach(parameter)
        XCTAssertTrue(parameterError.exists)
        enter(parameter, "QA parameter")
        assertCleared(parameterError)
        XCTAssertTrue(valueError.exists)
        let value = app.textFields["Значение"]
        reach(value)
        enter(value, "15")
        assertCleared(valueError)
        value.typeText("\n")
        reach(save)
        save.tap()
        XCTAssertTrue(app.navigationBars["Результаты обследований"].waitForExistence(timeout: 6))
        reach(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Validation exam'")).firstMatch)
    }
}
