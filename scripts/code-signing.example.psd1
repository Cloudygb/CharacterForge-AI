@{
    SignToolPath = "signtool"
    CertificateThumbprint = "<certificate-thumbprint>"
    CertificateSubject = "<certificate-subject>"
    ExpectedPublisher = "<expected-publisher-subject-fragment>"
    TimestampUrl = "https://timestamp.digicert.com"
    AdditionalSignToolArgs = @()
    Artifacts = @(
        "CharacterForgeAI.exe",
        "characterforgeai-installer.exe"
    )
}
