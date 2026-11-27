import SwiftUI

enum JournalTheme {
    static let paper = Color(uiColor: UIColor(red: 247/255, green: 249/255, blue: 246/255, alpha: 1))
    static let ink = Color(uiColor: UIColor(red: 30/255, green: 51/255, blue: 43/255, alpha: 1))
    static let secondary = Color(uiColor: UIColor(red: 87/255, green: 104/255, blue: 94/255, alpha: 1))
    static let green = Color(uiColor: UIColor(red: 36/255, green: 91/255, blue: 70/255, alpha: 1))
    static let fieldError = Color(uiColor: UIColor(red: 144/255, green: 57/255, blue: 44/255, alpha: 1))
    static let line = Color(uiColor: UIColor(red: 219/255, green: 227/255, blue: 219/255, alpha: 1))
    static let leaf = Color(uiColor: UIColor(red: 229/255, green: 239/255, blue: 227/255, alpha: 1))
    static let treatment = Color(uiColor: UIColor(red: 252/255, green: 246/255, blue: 227/255, alpha: 1))
    static let child = Color(uiColor: UIColor(red: 232/255, green: 230/255, blue: 241/255, alpha: 1))

    static let body = Font.custom("Inter-Regular", size: 16, relativeTo: .body)
    static let caption = Font.custom("Inter-Regular", size: 13, relativeTo: .footnote)

    static func title(_ size: CGFloat = 27, relativeTo style: Font.TextStyle = .title2) -> Font {
        .custom("PTSerif-Regular", size: size, relativeTo: style)
    }
}

extension View {
    func journalBackground() -> some View {
        scrollContentBackground(.hidden)
            .background(JournalTheme.paper.ignoresSafeArea())
            .listRowSeparatorTint(JournalTheme.line)
            .toolbarBackground(JournalTheme.paper, for: .navigationBar)
    }
}

struct JournalSectionHeading: View {
    let title: String
    init(_ title: String) { self.title = title }

    var body: some View {
        Text(title)
            .font(JournalTheme.title(24))
            .foregroundStyle(JournalTheme.ink)
            .textCase(nil)
            .accessibilityAddTraits(.isHeader)
            .padding(.leading, -2)
    }
}

struct JournalHero<Content: View>: View {
    let title: String
    var label: String
    var symbol = "book.closed"
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(label, systemImage: symbol)
                .font(JournalTheme.caption.weight(.semibold))
                .foregroundStyle(JournalTheme.green)
            Text(title)
                .font(JournalTheme.title(32, relativeTo: .largeTitle))
                .foregroundStyle(JournalTheme.ink)
                .accessibilityAddTraits(.isHeader)
                .fixedSize(horizontal: false, vertical: true)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background {
            ZStack(alignment: .trailing) {
                JournalTheme.leaf
                Image("JournalGinkgo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 144, height: 152)
                    .rotationEffect(.degrees(-8))
                    .offset(x: 20, y: 23)
                    .opacity(0.22)
                    .accessibilityHidden(true)
            }
        }
        .clipShape(.rect(cornerRadius: 18))
        .overlay {
            RoundedRectangle(cornerRadius: 18).strokeBorder(JournalTheme.green.opacity(0.15))
        }
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
    }
}

struct JournalPrimaryButton: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(JournalTheme.body.weight(.semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.horizontal, 12)
            .padding(.vertical, 2)
            .background(JournalTheme.green.opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.45),
                        in: .rect(cornerRadius: 11))
    }
}

struct JournalRowLabel: View {
    let title: String
    let symbol: String
    var subtitle = ""

    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: symbol)
                .foregroundStyle(JournalTheme.green)
                .font(.system(size: 16, weight: .medium))
                .frame(width: 34, height: 34)
                .background(JournalTheme.leaf, in: .rect(cornerRadius: 9))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(JournalTheme.body.weight(.medium)).foregroundStyle(JournalTheme.ink)
                if !subtitle.isEmpty {
                    Text(subtitle).font(JournalTheme.caption).foregroundStyle(JournalTheme.secondary)
                }
            }
        }
        .frame(minHeight: 44)
    }
}

struct JournalVisitLabel: View {
    let title: String
    let day: String
    let detail: String

    var body: some View {
        let date = CoursePeriod.date(day)
        HStack(spacing: 12) {
            VStack(spacing: 1) {
                Text(date?.formatted(.dateTime.day().locale(Locale(identifier: "ru_RU"))) ?? "··")
                    .font(JournalTheme.title(23, relativeTo: .title3))
                if let date {
                    Text(date.formatted(.dateTime.month(.abbreviated).locale(Locale(identifier: "ru_RU"))))
                        .font(JournalTheme.caption)
                }
            }
            .foregroundStyle(JournalTheme.green)
            .frame(minWidth: 48, minHeight: 49)
            .padding(.horizontal, 4)
            .background(JournalTheme.leaf, in: .rect(cornerRadius: 9))
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(JournalTheme.body.weight(.semibold)).foregroundStyle(JournalTheme.ink)
                if !detail.isEmpty {
                    Text(detail).font(JournalTheme.caption).foregroundStyle(JournalTheme.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint(day)
        .padding(.vertical, 4)
    }
}
