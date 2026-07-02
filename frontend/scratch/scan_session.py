with open(r"c:\Users\user\Desktop\rims\frontend\modules\interview\InterviewSession.tsx", "r", encoding="utf-8") as f:
    for i, line in enumerate(f, 1):
        if "setIsTerminated" in line or "setTerminationReason" in line:
            print(f"{i}: {line.strip()}")
