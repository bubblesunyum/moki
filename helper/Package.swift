// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "moki-helper",
    platforms: [.macOS(.v15)],
    products: [
        .executable(name: "moki-helper", targets: ["moki-helper"]),
        .library(name: "MokiHelperCore", targets: ["MokiHelperCore"]),
    ],
    targets: [
        .target(name: "MokiHelperCore"),
        .executableTarget(
            name: "moki-helper",
            dependencies: ["MokiHelperCore"]
        ),
        .testTarget(
            name: "MokiHelperCoreTests",
            dependencies: ["MokiHelperCore"]
        ),
    ]
)
