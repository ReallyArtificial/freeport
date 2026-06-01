# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Which versions are eligible for receiving such patches depends on the CVSS v3.0 Rating:

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

## Reporting a Vulnerability

The Freeport team takes security bugs seriously. We appreciate your efforts to responsibly disclose your findings, and will make every effort to acknowledge your contributions.

To report a security vulnerability, please use one of the following methods:

### 1. GitHub Security Advisories (Preferred)

Report security vulnerabilities through GitHub's Security Advisory feature:
1. Go to https://github.com/reallyartificial/freeport/security/advisories
2. Click "New draft security advisory"
3. Fill in the details of your finding

### 2. Email

Send an email to [harsh.joshi.pth@gmail.com](mailto:harsh.joshi.pth@gmail.com) with:
- Type of issue (e.g., API key exposure, injection, unauthorized access, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### What to Expect

- **Response Time**: You should receive a response within 48 hours.
- **Acknowledgment**: If the issue is confirmed, we will acknowledge it and work on a fix.
- **Updates**: We will keep you informed about the progress.
- **Disclosure**: We will coordinate with you on the disclosure timeline.

### Security Update Process

1. The security report is received and assigned to a primary handler
2. The problem is confirmed and a list of affected versions is determined
3. Code is audited to find any similar problems
4. Fixes are prepared for all supported releases
5. An advisory is published

## Security Best Practices for Users

When using Freeport in your projects:

1. **Keep Dependencies Updated**
   ```bash
   npm update freeport
   npm audit fix
   ```

2. **API Key Management**
   - Never hardcode API keys
   - Use environment variables for credentials
   - Implement key rotation policies
   - Use separate keys for dev/staging/prod

3. **Environment Variables**
   - Never commit `.env` files
   - Use secure secret management for production
   - Validate all provider configurations

4. **Provider Security**
   - Review provider security policies
   - Implement rate limiting
   - Monitor for unusual API usage
   - Use provider-specific security features

## Security Features

Freeport includes several security considerations:

- **Credential Isolation**: Provider credentials are isolated by namespace
- **Input Validation**: All inputs are validated before routing
- **No Eval**: No dynamic code execution via eval()
- **Audit Logging**: Provider calls can be logged for security review

## Third-Party Dependencies

We regularly update our dependencies to include the latest security patches. You can check the current dependencies status:

```bash
npm audit
```

## Contact

For any security-related questions that don't require reporting a vulnerability, please open a discussion in our GitHub repository.

Thank you for helping keep Freeport and its users safe!
