// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "moki-helper",
    platforms: [.macOS("26.0")],
    products: [
        .executable(name: "moki-helper", targets: ["moki-helper"]),
        .library(name: "MokiHelperCore", targets: ["MokiHelperCore"]),
    ],
    dependencies: [
        .package(path: "../../psymail-mini"),
    ],
    targets: [
        .target(
            name: "MokiHelperCore",
            dependencies: [.product(name: "PsymailKit", package: "psymail-mini")]
        ),
        .executableTarget(
            name: "moki-helper",
            dependencies: ["MokiHelperCore"]
        ),
        .testTarget(
            name: "MokiHelperCoreTests",
            dependencies: [
                "MokiHelperCore",
                .product(name: "PsymailKit", package: "psymail-mini"),
            ]
        ),
    ]
)
