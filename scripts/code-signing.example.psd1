@{
    SignToolPath = "signtool"
    CertificateThumbprint = "<certificate-thumbprint>"
    CertificateSubject = "<certificate-subject>"
    TimestampUrl = "https://timestamp.digicert.com"
    AdditionalSignToolArgs = @()
    Artifacts = @(
        "CharacterForgeAI.exe",
        "characterforgeai-installer.exe"
    )
}
