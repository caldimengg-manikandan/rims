import os
from dotenv import load_dotenv
# Configuration settings

# Load .env explicitly from this directory or parent
current_dir = os.path.dirname(__file__)
env_path = os.path.join(current_dir, ".env")
if not os.path.exists(env_path):
    env_path = os.path.join(current_dir, "..", ".env")

load_dotenv(env_path, override=True)

AI_PROVIDER = (os.getenv("AI_PROVIDER") or "groq").lower().strip()
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")

if AI_PROVIDER == "openrouter":
    MODEL_NAME = os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct")
else:
    MODEL_NAME = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

# Interview settings
MAX_QUESTIONS = 20
MIN_QUESTIONS = 3
QUESTION_DIFFICULTY_LEVELS = ["basic", "intermediate", "advanced", "scenario-based"]

# Skill categories
SKILL_CATEGORIES = {
    # Core Engineering / Specialized Domains (Moved to TOP for priority matching)
    "CAE-MECHANICAL":[
        "CAE", "Mechanical Engineering", "CAE-MECHANICAL",
        "HyperMesh", "OptiStruct", "LS-DYNA",
        "HyperView", "FEA fundamentals", "Structural Mechanics",
        "Material Science", "GD&T", "PLM Systems", "Thermal Analysis",
        "ANSYS", "Abaqus", "SolidWorks", "Catia"
    ],

    "Steel_detailing": [
        "tekla", "autocad", "SDS2", "Bluebeam",
        "Shop Drawings", "GA Drawings", "OSHA standards",
        "isometric views", "projection", "Steel detailing",
        "Tekla EPM", "Power Fab", "PowerFab", "ABM", "KSS",
        "3D Modeling", "2D drawings", "AISC", "CISC",
        "Structural detailing", "Estimation", "BOM",
        "RFI management", "Steel construction", "fabrication packages"
    ],

   # Electrical Domain
    "electrical": [
        "Electrical Engineering", "AutoCAD Electrical", "E3", "E-Plan", 
        "Circuit design", "Wiring Harness", "Electronics", "Hardware design", 
        "Panel Designing", "GA design", "Relay Interlocking", "Load Calculation", 
        "Cable Routing", "Component Selection", "System Architecture", 
        "Power Distribution", "Control Logic Design", "Industrial Automation", 
        "PLC", "HMI", "Switch gears", "Sensors", "Switches", "Controllers", 
        "Tool Handling", "Multimeter", "Clamp Meter", "Motor Analyser", 
        "Basic Troubleshooting", "2D Drafting"
    ],

    # Software Development
    "frontend": [
        "Frontend",
        "JavaScript", "React", "Angular", "Vue",
        "HTML", "CSS", "TypeScript"
    ],

    "backend": [
        "Python", "Java", "Node.js", "C#", "Go",
        "Databases", "REST APIs", "Microservices"
    ],

    # Data & AI
    "data_analysis": [
        "Data Science", "Data Engineering",
        "Python", "SQL",
        "Data Analysis",
        "Machine Learning",
        "Deep Learning",
        "PyTorch",
        "TensorFlow",
        "Big Data", 
        "Analytics"
    ],

    "fullstack": [
        "Fullstack",
        "Frontend + Backend",
        "End-to-End Application Development",
        "System Design",
        "DevOps Basics"
    ],

    "devops": [
        "DevOps",
        "AWS", "Azure", "GCP",
        "Docker", "Kubernetes",
        "CI/CD Pipelines",
        "Terraform",
        "Linux"
    ],

    "networking": [
        "Networking", "Network Engineering",
        "Computer Networks",
        "TCP/IP",
        "Routing & Switching",
        "LAN / WAN",
        "DNS",
        "DHCP",
        "Firewalls",
        "VPN",
        "Network Security"
    ],
    # Mobile Development
    "mobile": [
        "App Development",
        "iOS Development", "Android Development",
        "Android",
        "iOS",
        "React Native",
        "Flutter",
        "Swift", "Kotlin"
    ],

    # Human Resources
    "hr": [
        "HR", "Human Resources",
        "Recruitment & Staffing",
        "Talent Acquisition",
        "HR Operations",
        "Payroll Management",
        "Employee Relations",
        "Performance Management",
        "HR Policies & Compliance",
        "Onboarding & Offboarding"
    ],

    # Additional Useful Domains
    "qa_testing": [
        "QA", "Testing", "Quality Assurance",
        "Manual Testing",
        "Automation Testing",
        "Selenium",
        "Cypress",
        "API Testing",
        "Performance Testing"
    ],

    "ui_ux": [
        "UI", "UX", "UI/UX", "Product Design",
        "User Research",
        "Wireframing",
        "Prototyping",
        "Figma",
        "Adobe XD",
        "Usability Testing"
    ],

    "cybersecurity": [
        "Cybersecurity", "Security", "InfoSec",
        "Information Security",
        "Threat Modeling",
        "Vulnerability Assessment",
        "Penetration Testing",
        "IAM",
        "SIEM",
        "SOC Operations"
    ],
    "digital_marketing": [
        "Digital Marketing", "SEO", "Search Engine Optimization",
        "SEM", "Search Engine Marketing", "Google Ads",
        "Content Marketing", "Social Media Marketing",
        "Email Marketing", "PPC", "Marketing Analytics",
        "Google Analytics", "Performance Marketing",
        "Brand Management", "Copywriting", "Campaign Management",
        "Marketing Automation", "HubSpot", "Mailchimp"
    ],
    "embedded_systems": [
        "Embedded Systems", "Embedded C", "Embedded C++",
        "RTOS", "FreeRTOS", "Bare Metal Programming",
        "Arduino", "Raspberry Pi", "STM32", "ESP32",
        "ARM Cortex", "8051", "AVR", "PIC",
        "Microcontrollers", "Microprocessors",
        "UART", "SPI", "I2C", "CAN", "RS485", "Modbus",
        "Firmware Development", "Bootloader", "Device Drivers",
        "GPIO", "ADC", "DAC", "PWM", "Interrupts",
        "JTAG", "Oscilloscope", "Logic Analyzer",
        "PCB Design", "Altium", "KiCad", "Eagle"
    ],
    "instrumentation": [
        "Instrumentation Engineering", "Process Control",
        "SCADA", "DCS", "PLC", "HMI",
        "P&ID", "Loop Diagrams", "Instrument Data Sheets",
        "Field Instruments", "Transmitters", "Sensors",
        "Flow Meters", "Pressure Gauges", "Temperature Sensors",
        "Level Sensors", "Control Valves", "Actuators",
        "Calibration", "Loop Calibration", "HART Protocol",
        "Foundation Fieldbus", "Profibus", "OPC",
        "ISA Standards", "IEC 61511", "Functional Safety",
        "SIL", "HAZOP", "Instrument Hook-up Drawings"
    ],
    "generative_ai": [
        "Generative AI", "LLM", "Large Language Models",
        "Prompt Engineering", "Prompt Design",
        "LangChain", "LlamaIndex", "RAG",
        "Retrieval Augmented Generation",
        "Fine-tuning", "LoRA", "QLoRA",
        "OpenAI", "Claude", "Gemini", "Mistral", "Llama",
        "Hugging Face", "Transformers",
        "Vector Databases", "Pinecone", "ChromaDB", "FAISS",
        "Embeddings", "Semantic Search",
        "AI Agents", "Tool Use", "Function Calling",
        "ChatGPT", "GPT-4", "Anthropic API", "OpenAI API"
    ],
    "business_intelligence": [
        "Business Intelligence", "BI",
        "Power BI", "Tableau", "Looker", "QlikView", "Qlik Sense",
        "DAX", "Power Query", "M Language",
        "Data Visualization", "Dashboard Design",
        "KPI Reporting", "Executive Reporting",
        "SQL", "Data Modeling", "Star Schema", "Snowflake Schema",
        "ETL", "Data Warehouse", "SSRS", "SSAS",
        "Google Data Studio", "Metabase", "Superset",
        "Excel Advanced", "Pivot Tables", "VBA"
    ],
    "database_admin": [
        "Database Administration", "DBA",
        "MySQL", "PostgreSQL", "Oracle", "SQL Server", "SQLite",
        "MongoDB", "Cassandra", "Redis", "DynamoDB",
        "Query Optimization", "Indexing", "Partitioning",
        "Backup & Recovery", "Replication", "Clustering",
        "Database Design", "ER Diagrams", "Normalization",
        "Stored Procedures", "Triggers", "Views",
        "Performance Tuning", "Execution Plans",
        "Database Security", "Role Management",
        "Migration", "Data Archiving"
    ],
    "project_management": [
        "Project Management", "PMP", "PRINCE2",
        "Agile", "Scrum", "Kanban", "SAFe",
        "JIRA", "Confluence", "MS Project", "Asana", "Trello",
        "Sprint Planning", "Backlog Grooming", "Retrospectives",
        "Risk Management", "Issue Tracking", "Change Management",
        "Stakeholder Management", "Resource Planning",
        "Budget Management", "Project Scheduling",
        "WBS", "Gantt Chart", "Critical Path Method",
        "Earned Value Management", "SLA Management",
        "Cross-functional Team Leadership"
    ],
    "business_analyst": [
        "Business Analysis", "Business Analyst",
        "Requirements Gathering", "BRD", "FRD", "SRS",
        "Use Case Diagrams", "User Stories", "Acceptance Criteria",
        "Process Mapping", "As-Is To-Be Analysis",
        "Gap Analysis", "Impact Analysis", "SWOT Analysis",
        "Wireframing", "Prototyping", "Mockups",
        "Stakeholder Interviews", "Workshop Facilitation",
        "JIRA", "Confluence", "Visio", "Lucidchart",
        "SQL", "Excel", "Data Analysis",
        "UAT", "Testing Support", "Change Management",
        "Agile BA", "Scrum", "Domain Knowledge"
    ],
    "finance_accounting": [
        "Finance", "Accounting", "Financial Analysis",
        "Tally", "Tally ERP", "SAP FICO", "SAP S4 HANA",
        "QuickBooks", "Zoho Books",
        "GST", "TDS", "Income Tax", "Taxation",
        "Financial Reporting", "MIS Reports", "Balance Sheet",
        "P&L", "Cash Flow", "Budgeting", "Forecasting",
        "Auditing", "Internal Audit", "Statutory Audit",
        "Accounts Payable", "Accounts Receivable",
        "Bank Reconciliation", "General Ledger",
        "IFRS", "Ind AS", "GAAP", "Cost Accounting",
        "Financial Modeling", "Variance Analysis"
    ],
    "sales_crm": [
        "Sales", "CRM", "Business Development",
        "Salesforce", "HubSpot CRM", "Zoho CRM", "Pipedrive",
        "Lead Generation", "Cold Calling", "Cold Emailing",
        "B2B Sales", "B2C Sales", "Inside Sales", "Field Sales",
        "Account Management", "Key Account Management",
        "Sales Funnel", "Pipeline Management",
        "Negotiation", "Objection Handling", "Closing Skills",
        "Target Achievement", "Revenue Growth",
        "Presales", "Solution Selling", "Consultative Selling",
        "Client Relationship Management", "Upselling", "Cross-selling"
    ],
    "customer_support": [
        "Customer Support", "Customer Service", "Technical Support",
        "L1 Support", "L2 Support", "L3 Support",
        "Helpdesk", "Service Desk", "IT Support",
        "Zendesk", "Freshdesk", "ServiceNow", "JIRA Service Desk",
        "Ticketing System", "SLA Management", "CSAT",
        "Incident Management", "Problem Management",
        "Remote Support", "Desktop Support",
        "Troubleshooting", "Root Cause Analysis",
        "Chat Support", "Email Support", "Voice Support",
        "ITIL", "ITSM", "Knowledge Base Management"
    ],
    "legal": [
        "Legal", "Law", "Corporate Law",
        "Contract Drafting", "Contract Review", "Contract Negotiation",
        "Legal Research", "Legal Documentation",
        "Compliance", "Regulatory Compliance", "GDPR",
        "Intellectual Property", "IP Law", "Trademark", "Copyright", "Patent",
        "Labour Law", "Employment Law",
        "Litigation", "Arbitration", "Dispute Resolution",
        "Company Law", "MCA Filings", "ROC Compliance",
        "Due Diligence", "Legal Advisory",
        "NDA", "MOU", "SLA Drafting"
    ],
    "healthcare_it": [
        "Healthcare IT", "Health Informatics",
        "HL7", "FHIR", "DICOM",
        "EMR", "EHR", "Electronic Health Records",
        "Hospital Information System", "HIS",
        "Medical Coding", "ICD-10", "CPT Codes",
        "Clinical Data Management", "CDM",
        "Pharmacy Management System",
        "Telemedicine", "Healthcare Analytics",
        "HIPAA Compliance", "Patient Data Privacy",
        "RCM", "Revenue Cycle Management",
        "Lab Information System", "LIS",
        "Radiology Information System", "RIS"
    ],
    "graphic_design": [
        "Graphic Design", "Visual Design", "Creative Design",
        "Adobe Photoshop", "Adobe Illustrator", "Adobe InDesign",
        "Canva", "CorelDRAW", "Figma",
        "Brand Identity", "Logo Design", "Typography",
        "Color Theory", "Layout Design", "Print Design",
        "Social Media Design", "Banner Design", "Poster Design",
        "Packaging Design", "Brochure Design",
        "Motion Graphics", "After Effects",
        "UI Design", "Icon Design",
        "Photo Editing", "Photo Retouching", "Image Manipulation"
    ],
    "video_editing": [
        "Video Editing", "Video Production", "Post Production",
        "Adobe Premiere Pro", "Final Cut Pro", "DaVinci Resolve",
        "Adobe After Effects", "Motion Graphics",
        "Color Grading", "Color Correction",
        "Audio Editing", "Adobe Audition", "Sound Design",
        "Storyboarding", "Script Writing",
        "YouTube Content", "Reels Editing", "Short Form Video",
        "Transitions", "Visual Effects", "VFX",
        "3D Animation", "Blender", "Cinema 4D",
        "Screen Recording", "OBS", "Camtasia"
    ]
}


# Termination keywords
TERMINATION_KEYWORDS = [
    "terminate the interview", "i want to quit", "i want to exit", 
    "i want to end the interview", "quit the interview", "exit the interview",
    "stop the interview", "end this now", "cancel interview"
] 
ABUSIVE_KEYWORDS = [
    "fuck", "shit", "stupid", "idiot", "dumb", "worthless", "hate", "useless",
    "bitch", "bastard", "asshole", "damn", "crap"
]
