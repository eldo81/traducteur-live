pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // Moteur SIP/VoIP Linphone (Belledonne Communications)
        maven { url = uri("https://download.linphone.org/maven_repository") }
    }
}
rootProject.name = "DioneoCall"
include(":app")
