from crewai.tools import tool

@tool("Mock Gmail Sender")
def mock_gmail_sender(email_address: str, subject: str, body: str) -> str:
    """
    Sends an email using a simulated Gmail API.
    Args:
        email_address: The recipient email address.
        subject: The subject of the email.
        body: The body content of the email.
    """
    return f"Successfully sent email to {email_address} with subject '{subject}'"

@tool("Mock Click2Mail Dispatcher")
def mock_click2mail_dispatcher(address: str, document_content: str) -> str:
    """
    Sends a physical letter using a simulated Click2Mail API.
    Args:
        address: The physical mailing address.
        document_content: The content of the document to mail.
    """
    return f"Successfully queued physical mail to {address}"

@tool("Web Search Emulator")
def web_search_emulator(query: str) -> str:
    """
    Emulates a web search for gathering data.
    Args:
        query: The search query.
    """
    return f"Found simulated information for query: {query}. It indicates positive trends and key data points."
