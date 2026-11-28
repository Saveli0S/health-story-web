import SwiftUI
import PDFKit

struct NativeSourcePosition: Equatable {
    var sourceID = ""
    var page = 1
    var zoom = 100.0
    var top = 0.0
    var left = 0.0

    init(_ row: JournalObject = [:]) {
        sourceID = caption(row, "sourceId")
        page = max(1, row["page"] as? Int ?? 1)
        zoom = min(500, max(25, row["zoom"] as? Double ?? 100))
        top = max(0, row["top"] as? Double ?? 0)
        left = max(0, row["left"] as? Double ?? 0)
    }

    var json: JournalObject { ["sourceId": sourceID, "page": page, "zoom": zoom, "top": top, "left": left] }
}

struct NativeSourceItem: Identifiable {
    let id: String, name: String
}

struct NativeSourceReview<Fields: View>: View {
    let sources: [NativeSourceItem]
    @Binding var position: NativeSourcePosition
    let load: (String) async throws -> FamilyArchive.Original
    @ViewBuilder var fields: () -> Fields
    @State private var showingSource = false
    @State private var opened = false
    @State private var original: FamilyArchive.Original?
    @State private var notice = ""

    private var source: NativeSourceItem? { sources.first { $0.id == position.sourceID } ?? sources.first }

    var body: some View {
        VStack(spacing: 0) {
            if !sources.isEmpty {
                Picker("Режим сверки", selection: $showingSource) {
                    Text("Поля").tag(false)
                    Text("Оригинал").tag(true)
                }.pickerStyle(.segmented).padding(.horizontal).padding(.vertical, 8)
            }
            let showsOriginal = showingSource && !sources.isEmpty
            ZStack {
                fields().opacity(showsOriginal ? 0 : 1).allowsHitTesting(!showsOriginal)
                    .accessibilityHidden(showsOriginal)
                if opened, let source {
                    VStack(spacing: 8) {
                        if sources.count > 1 {
                            Picker("Выбрать оригинал", selection: Binding(get: { source.id }, set: { id in
                                var reset = NativeSourcePosition()
                                reset.sourceID = id
                                position = reset
                            })) {
                                ForEach(sources) { Text($0.name).tag($0.id) }
                            }
                        }
                        if let original, original.id == source.id || original.id.hasSuffix("/" + source.id) {
                            NativeReviewPreview(original: original, name: source.name, position: $position)
                                .id(source.id)
                        } else if !notice.isEmpty {
                            ContentUnavailableView("Оригинал недоступен", systemImage: "doc", description: Text(notice))
                        } else { ProgressView("Открываем документ…").frame(maxHeight: .infinity) }
                    }
                    .opacity(showsOriginal ? 1 : 0).allowsHitTesting(showsOriginal)
                    .accessibilityHidden(!showsOriginal)
                    .task(id: source.id) {
                        original = nil
                        notice = ""
                        do {
                            let loaded = try await load(source.id)
                            guard !Task.isCancelled else { return }
                            if position.sourceID != source.id { position.sourceID = source.id }
                            original = loaded
                        } catch is CancellationError {} catch {
                            notice = error.localizedDescription
                        }
                    }
                }
            }
        }
        .onChange(of: showingSource) { _, showing in
            if showing { opened = true }
        }
    }
}

private struct NativeReviewPreview: View {
    let original: FamilyArchive.Original, name: String
    @Binding var position: NativeSourcePosition

    var body: some View {
        if let pdf = PDFDocument(data: original.bytes), pdf.pageCount > 0 {
            ReviewPDF(document: pdf, position: $position)
        } else if let photo = UIImage(data: original.bytes) {
            ReviewPhoto(image: photo, name: name, position: $position)
        } else if original.type.hasPrefix("text/"), let text = String(data: original.bytes, encoding: .utf8) {
            ScrollView { Text(text).padding().textSelection(.enabled) }
        } else {
            AttachmentView(original: original, name: name)
        }
    }
}

private struct ReviewPDF: UIViewRepresentable {
    let document: PDFDocument
    @Binding var position: NativeSourcePosition

    func makeCoordinator() -> Coordinator { Coordinator(position: $position) }

    func makeUIView(context: Context) -> PDFView {
        let view = PositionedPDF()
        view.document = document
        view.autoScales = true
        view.initialLayout = { [weak coordinator = context.coordinator, weak view] in
            if let view { coordinator?.start(view) }
        }
        return view
    }

    func updateUIView(_ uiView: PDFView, context: Context) {
        context.coordinator.position = $position
    }

    private final class PositionedPDF: PDFView {
        var initialLayout: (() -> Void)?
        override func layoutSubviews() {
            super.layoutSubviews()
            if bounds.width > 0, let initialLayout {
                self.initialLayout = nil
                initialLayout()
            }
        }
    }

    final class Coordinator: NSObject {
        var position: Binding<NativeSourcePosition>
        private var observation: NSKeyValueObservation?
        private var observers: [NSObjectProtocol] = []
        private var baseline: CGFloat = 1
        private var sourceID = ""

        init(position: Binding<NativeSourcePosition>) { self.position = position }

        func start(_ view: PDFView) {
            let saved = position.wrappedValue
            sourceID = saved.sourceID
            let fit = view.scaleFactorForSizeToFit
            if fit.isFinite && fit > 0 { baseline = fit }
            if let document = view.document, let page = document.page(at: min(saved.page, document.pageCount) - 1) {
                view.go(to: page)
            }
            if saved.zoom != 100 {
                view.autoScales = false
                view.scaleFactor = min(view.maxScaleFactor, max(view.minScaleFactor, baseline * saved.zoom / 100))
            }
            if let scroll = view.subviews.compactMap({ $0 as? UIScrollView }).first {
                if saved.left > 0 || saved.top > 0 { scroll.setContentOffset(CGPoint(x: saved.left, y: saved.top), animated: false) }
                observation = scroll.observe(\.contentOffset) { [weak self, weak view] _, _ in
                    if let view { self?.record(view) }
                }
            }
            for name in [Notification.Name.PDFViewPageChanged, .PDFViewScaleChanged] {
                observers.append(NotificationCenter.default.addObserver(forName: name, object: view, queue: .main) { [weak self, weak view] _ in
                    if let view { self?.record(view) }
                })
            }
        }

        private func record(_ view: PDFView) {
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, let view, let page = view.currentPage, let document = view.document else { return }
                var value = position.wrappedValue
                guard value.sourceID == sourceID else { return }
                value.page = document.index(for: page) + 1
                value.zoom = (view.scaleFactor / baseline * 100).rounded()
                if let scroll = view.subviews.compactMap({ $0 as? UIScrollView }).first {
                    value.top = max(0, scroll.contentOffset.y)
                    value.left = max(0, scroll.contentOffset.x)
                }
                if position.wrappedValue != value { position.wrappedValue = value }
            }
        }

        deinit {
            for item in observers { NotificationCenter.default.removeObserver(item) }
        }
    }
}

private struct ReviewPhoto: UIViewRepresentable {
    let image: UIImage, name: String
    @Binding var position: NativeSourcePosition

    func makeCoordinator() -> Coordinator { Coordinator(position: $position) }

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = PhotoScroll()
        let picture = context.coordinator.picture
        picture.image = image
        picture.contentMode = .scaleAspectFit
        picture.isAccessibilityElement = true
        picture.accessibilityLabel = name
        scroll.addSubview(picture)
        scroll.delegate = context.coordinator
        scroll.maximumZoomScale = 5
        scroll.initialLayout = { [weak scroll, weak coordinator = context.coordinator] in
            guard let scroll, let coordinator else { return }
            let saved = coordinator.position.wrappedValue
            let width = scroll.bounds.width
            let height = width * image.size.height / max(1, image.size.width)
            picture.frame = CGRect(x: 0, y: 0, width: width, height: height)
            scroll.contentSize = picture.frame.size
            scroll.zoomScale = min(5, max(1, saved.zoom / 100))
            scroll.contentOffset = CGPoint(x: min(saved.left, max(0, scroll.contentSize.width - scroll.bounds.width)),
                                           y: min(saved.top, max(0, scroll.contentSize.height - scroll.bounds.height)))
            coordinator.loaded = true
        }
        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {
        context.coordinator.position = $position
    }

    private final class PhotoScroll: UIScrollView {
        var initialLayout: (() -> Void)?
        override func layoutSubviews() {
            super.layoutSubviews()
            if bounds.width > 0, let initialLayout {
                self.initialLayout = nil
                initialLayout()
            }
        }
    }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        let picture = UIImageView()
        var position: Binding<NativeSourcePosition>
        var loaded = false
        private let sourceID: String

        init(position: Binding<NativeSourcePosition>) {
            self.position = position
            sourceID = position.wrappedValue.sourceID
        }

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { picture }
        func scrollViewDidScroll(_ scrollView: UIScrollView) { record(scrollView) }
        func scrollViewDidZoom(_ scrollView: UIScrollView) { record(scrollView) }

        private func record(_ scroll: UIScrollView) {
            guard loaded else { return }
            DispatchQueue.main.async { [weak self, weak scroll] in
                guard let self, let scroll else { return }
                var value = position.wrappedValue
                guard value.sourceID == sourceID else { return }
                value.zoom = (scroll.zoomScale * 100).rounded()
                value.top = max(0, scroll.contentOffset.y)
                value.left = max(0, scroll.contentOffset.x)
                if position.wrappedValue != value { position.wrappedValue = value }
            }
        }
    }
}
