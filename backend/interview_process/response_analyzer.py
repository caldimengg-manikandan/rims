import re
import asyncio
import logging
from typing import Dict, Tuple
from .config import MODEL_NAME, SKILL_CATEGORIES
from .utils import extract_skills, analyze_response_quality
from app.services.ai_client import ai_client, is_ai_unavailable_response

logger = logging.getLogger(__name__)

class ResponseAnalyzer:
    def __init__(self):
        self.ai_client = ai_client
        self.client = ai_client.client if ai_client else None

    def _fallback_analysis(self, response: str) -> Dict:
        """Fallback analysis when AI analysis fails"""
        from .utils import extract_skills
        
        skills = extract_skills(response)
        
        # Simple skill categorization
        skill_counts = {cat: 0 for cat in SKILL_CATEGORIES}
        
        for skill in skills:
            s = skill.lower()
            for cat, keywords in SKILL_CATEGORIES.items():
                for k in keywords:
                    if k.lower() in s:
                        skill_counts[cat] += 1
        
        # Determine primary skill
        primary_skill = max(skill_counts, key=skill_counts.get) if skill_counts else "backend"
        if skill_counts.get(primary_skill, 0) == 0:
            primary_skill = "backend"
        
        # Estimate experience level based on word count and content
        word_count = len(response.split())
        if word_count < 100:
            experience = "junior"
            confidence = "low"
        elif word_count < 250:
            experience = "mid"
            confidence = "medium"
        else:
            experience = "senior"
            confidence = "high"
        
        # Count projects mentioned (simple heuristic)
        project_indicators = ["project", "built", "developed", "created", "implemented", "designed"]
        projects_mentioned = sum(1 for indicator in project_indicators if indicator in response.lower())
        
        # Estimate communication quality
        if word_count < 50:
            communication = "weak"
        elif word_count > 500:
            communication = "weak"  # Too verbose
        else:
            communication = "adequate"
        
        # Calculate intro score
        intro_score = 6  # Base
        if len(skills) >= 3:
            intro_score += 1
        if projects_mentioned >= 2:
            intro_score += 1
        if word_count >= 150 and word_count <= 400:
            intro_score += 1
        if communication == "adequate":
            intro_score += 1
        
        return {
            "skills": skills,
            "experience": experience,
            "primary_skill": primary_skill,
            "confidence": confidence,
            "communication": communication,
            "projects_mentioned": projects_mentioned,
            "word_count": word_count,
            "intro_score": min(10, max(1, intro_score))  # Keep between 1-10
        }



    def _parse_intro_analysis(self, analysis_text: str, original_response: str) -> Dict:
        """Parse introduction analysis with detailed metrics"""
        # Initialize with defaults
        result = {
            "skills": [],
            "experience": "mid",
            "primary_skill": "frontend",
            "confidence": "medium",
            "communication": "adequate",
            "projects_mentioned": 0,
            "word_count": len(original_response.split()),
            "intro_score": 7
        }
        
        # If analysis_text is empty or too short, use fallback
        if not analysis_text or len(analysis_text.strip()) < 20:
            logger.debug("Intro parse: AI analysis text too short; using enhanced fallback")
            return self._enhanced_fallback_analysis(original_response)
        
        lines = analysis_text.strip().split('\n')
        
        # Try to extract information with multiple patterns
        for line in lines:
            line = line.strip()
            if not line:
                continue
                
            line_lower = line.lower()
            
            # Extract skills with multiple patterns
            if "skill" in line_lower and ("primary" in line_lower or "main" in line_lower or ":" in line):
                if ":" in line:
                    parts = line.split(":", 1)
                    if len(parts) > 1:
                        skill_text = parts[1].strip()
                        # Extract skill from text
                        skill = self._extract_skill_from_text(skill_text)
                        if skill:
                            result["primary_skill"] = skill
            
            # Extract experience level
            elif "experience" in line_lower and ":" in line:
                parts = line.split(":", 1)
                if len(parts) > 1:
                    exp_text = parts[1].strip().lower()
                    result["experience"] = self._categorize_experience(exp_text)
            
            # Extract confidence
            elif "confidence" in line_lower and ":" in line:
                parts = line.split(":", 1)
                if len(parts) > 1:
                    conf_text = parts[1].strip().lower()
                    result["confidence"] = self._categorize_confidence(conf_text)
            
            # Extract communication
            elif "communication" in line_lower and ":" in line:
                parts = line.split(":", 1)
                if len(parts) > 1:
                    comm_text = parts[1].strip().lower()
                    result["communication"] = self._categorize_communication(comm_text)
            
            # Extract projects count
            elif "project" in line_lower and ":" in line:
                parts = line.split(":", 1)
                if len(parts) > 1:
                    try:
                        result["projects_mentioned"] = int(parts[1].strip())
                    except:
                        # Try to extract number from text
                        numbers = re.findall(r'\d+', parts[1])
                        if numbers:
                            result["projects_mentioned"] = int(numbers[0])
            
            # Extract all skills mentioned (not just primary)
            elif "skill" in line_lower and ":" in line and "primary" not in line_lower and "main" not in line_lower:
                parts = line.split(":", 1)
                if len(parts) > 1:
                    skills_text = parts[1].strip()
                    # Parse comma-separated skills
                    skills = [s.strip().lower() for s in skills_text.split(",") if s.strip()]
                    if skills:
                        result["skills"] = skills
        
        # If no skills extracted, use fallback extraction
        if not result["skills"]:
            result["skills"] = extract_skills(original_response)
        
        # Calculate a more nuanced score based on the actual response content
        result["intro_score"] = self._calculate_intro_score(result, original_response)
        
        # If we got generic defaults, try to infer better from the response
        if result["primary_skill"] == "frontend" and result["experience"] == "mid" and result["confidence"] == "medium":
            # Try to infer from response content
            result = self._infer_from_content(original_response, result)
        
        return result
    
    def _extract_skill_from_text(self, text: str) -> str:
        """Extract skill category from text using config first"""
        text_lower = text.lower()
        
        # Use config-driven mapping first (Source of Truth)
        try:
            from .config import SKILL_CATEGORIES
            # Sort categories to give priority to more specific ones if needed, 
            # or just iterate.
            for category, keywords in SKILL_CATEGORIES.items():
                for keyword in keywords:
                    if keyword.lower() in text_lower:
                        return category
        except Exception:
            pass
            
        # Hardcoded fallbacks if config fails
        skill_mapping = {
            "backend": ["backend", "back-end", "server", "api", "database", "python", "java", "node", "spring"],
            "frontend": ["frontend", "front-end", "react", "angular", "vue", "javascript", "ui", "ux"],
            "devops": ["devops", "aws", "docker", "kubernetes", "ci/cd"],
            "data_analysis": ["data science", "machine learning", "ml", "ai", "analytics"],
            "Steel_detailing": ["tekla", "autocad", "sds2", "steel detailing", "aisc", "cisc"],
            "CAE-MECHANICAL": ["hypermesh", "optistruct", "ls-dyna", "fea"]
        }
        
        for skill, keywords in skill_mapping.items():
            for keyword in keywords:
                if keyword in text_lower:
                    return skill
        
        return "general"  # Default

    def _categorize_experience(self, text: str) -> str:
        """Categorize experience level from text"""
        text_lower = text.lower()
        
        if any(word in text_lower for word in ["junior", "entry", "beginner", "early", "0-2", "1-3"]):
            return "junior"
        elif any(word in text_lower for word in ["senior", "lead", "principal", "expert", "5+", "7+", "10+"]):
            return "senior"
        else:
            return "mid"

    def _categorize_confidence(self, text: str) -> str:
        """Categorize confidence level from text"""
        text_lower = text.lower()
        
        if any(word in text_lower for word in ["high", "strong", "very confident", "excellent"]):
            return "high"
        elif any(word in text_lower for word in ["low", "weak", "not confident", "poor"]):
            return "low"
        else:
            return "medium"

    def _categorize_communication(self, text: str) -> str:
        """Categorize communication quality from text"""
        text_lower = text.lower()
        
        if any(word in text_lower for word in ["strong", "excellent", "good", "clear", "effective"]):
            return "strong"
        elif any(word in text_lower for word in ["weak", "poor", "unclear", "needs improvement"]):
            return "weak"
        else:
            return "adequate"

    def _calculate_intro_score(self, analysis: Dict, response: str) -> int:
        """Calculate introduction score based on multiple factors"""
        score = 7  # Base score
        
        # Factor 1: Word count (100-300 words is ideal)
        word_count = analysis["word_count"]
        if 150 <= word_count <= 350:
            score += 1
        elif word_count < 80:
            score -= 1
        elif word_count > 500:
            score -= 1
        
        # Factor 2: Skills mentioned
        skills_count = len(analysis["skills"])
        if skills_count >= 5:
            score += 1
        elif skills_count <= 2:
            score -= 1
        
        # Factor 3: Experience level (senior gets bonus)
        if analysis["experience"] == "senior":
            score += 1
        elif analysis["experience"] == "junior":
            score -= 0.5
        
        # Factor 4: Confidence
        if analysis["confidence"] == "high":
            score += 1
        elif analysis["confidence"] == "low":
            score -= 1
        
        # Factor 5: Communication
        if analysis["communication"] == "strong":
            score += 1
        elif analysis["communication"] == "weak":
            score -= 1
        
        # Factor 6: Projects mentioned
        if analysis["projects_mentioned"] >= 2:
            score += 1
        elif analysis["projects_mentioned"] == 0:
            score -= 1
        
        # Factor 7: Check for specific content indicators
        response_lower = response.lower()
        if any(term in response_lower for term in ["implemented", "developed", "built", "created"]):
            score += 0.5
        if any(term in response_lower for term in ["achieved", "improved", "increased", "reduced"]):
            score += 0.5
        if "team" in response_lower or "collaborat" in response_lower:
            score += 0.5
        
        # Ensure score is between 1-10
        return max(1, min(10, int(score)))

    def _infer_from_content(self, response: str, current_result: Dict) -> Dict:
        """Infer analysis from response content when AI gives generic results"""
        response_lower = response.lower()
        
        # Infer primary skill from content
        skill_indicators = {
            "backend": ["python", "java", "spring", "django", "flask", "node", "express", "api", "server", "database"],
            "frontend": ["react", "angular", "vue", "javascript", "typescript", "html", "css", "ui", "frontend"],
            "devops": ["aws", "docker", "kubernetes", "terraform", "ci/cd", "devops", "infrastructure"],
            "data": ["machine learning", "data science", "ai", "ml", "tensorflow", "pytorch", "analytics"],
            "mobile": ["android", "ios", "mobile", "react native", "flutter", "swift", "kotlin"]
        }
        
        skill_scores = {skill: 0 for skill in skill_indicators.keys()}
        for skill, indicators in skill_indicators.items():
            for indicator in indicators:
                if indicator in response_lower:
                    skill_scores[skill] += 1
        
        # Update primary skill if we found strong indicators
        max_skill = max(skill_scores, key=skill_scores.get) 
        if skill_scores[max_skill] > 2:  # Only update if we have strong evidence
            current_result["primary_skill"] = max_skill
        
        # Infer experience from content
        word_count = len(response.split())
        senior_indicators = ["led", "managed", "architected", "designed", "mentored", "10+", "8+", "senior"]
        junior_indicators = ["recent graduate", "bootcamp", "entry level", "seeking first", "0-2 years", "1-3 years"]
        
        senior_count = sum(1 for indicator in senior_indicators if indicator in response_lower)
        junior_count = sum(1 for indicator in junior_indicators if indicator in response_lower)
        
        if senior_count > 2:
            current_result["experience"] = "senior"
            current_result["confidence"] = "high"
        elif junior_count > 1:
            current_result["experience"] = "junior"
            current_result["confidence"] = "medium"
        elif word_count > 300:
            current_result["experience"] = "senior"
            current_result["confidence"] = "high"
        elif word_count < 100:
            current_result["experience"] = "junior"
            current_result["confidence"] = "medium"
        
        # Infer confidence from sentence structure and assertiveness
        confident_indicators = ["confident", "experienced", "expert", "proficient", "strong", "extensive"]
        uncertain_indicators = ["basic", "familiar", "learning", "beginner", "some experience"]
        
        confident_count = sum(1 for indicator in confident_indicators if indicator in response_lower)
        uncertain_count = sum(1 for indicator in uncertain_indicators if indicator in response_lower)
        
        if confident_count > uncertain_count:
            current_result["confidence"] = "high"
        elif uncertain_count > confident_count:
            current_result["confidence"] = "low"
        
        return current_result

    def _enhanced_fallback_analysis(self, response: str) -> Dict:
        """Enhanced fallback analysis with better inference"""
        from .utils import extract_skills
        
        skills = extract_skills(response)
        word_count = len(response.split())
        
        # Skill inference uses SKILL_CATEGORIES from config
        
        skill_scores = {skill: 0 for skill in SKILL_CATEGORIES.keys()}
        for skill in skills:
            skill_lower = skill.lower()
            for skill_type, indicators in SKILL_CATEGORIES.items():
                if any(indicator.lower() in skill_lower for indicator in indicators):
                    skill_scores[skill_type] += 1
        
        # If still no matches, try keyword matching on full text
        if max(skill_scores.values()) == 0:
            for skill_type, indicators in SKILL_CATEGORIES.items():
                for indicator in indicators:
                    if indicator.lower() in response.lower():
                        skill_scores[skill_type] += 1

        primary_skill = max(skill_scores, key=skill_scores.get) # type: ignore
        if skill_scores[primary_skill] == 0:
            primary_skill = "general"
        
        # Enhanced experience inference
        senior_keywords = ["led", "managed", "architected", "designed", "mentored", "10+", "6+", "7+", "8+", "9+", "senior", "principal", "lead"]
        junior_keywords = ["recent graduate", "bootcamp", "entry level", "seeking first","0-2 years", "1-3 years", "3 years", "months", "1 years", "2 years", "junior"]
        
        senior_count = sum(1 for keyword in senior_keywords if keyword in response.lower())
        junior_count = sum(1 for keyword in junior_keywords if keyword in response.lower())
        
        if senior_count > 2:
            experience = "senior"
            confidence = "high"
        elif junior_count > 1:
            experience = "junior"
            confidence = "medium"
        elif word_count > 400:
            experience = "senior"
            confidence = "high"
        elif word_count < 150:
            experience = "junior"
            confidence = "medium"
        else:
            experience = "mid"
            confidence = "medium"
        
        # Enhanced project counting
        project_patterns = [
            r"project\s+(?:called|named|titled)?\s*['\"]?([^'\"]+)['\"]?",
            r"built\s+(?:a|an)?\s*([^,.]+)",
            r"developed\s+(?:a|an)?\s*([^,.]+)",
            r"created\s+(?:a|an)?\s*([^,.]+)"
        ]
        
        projects_mentioned = 0
        for pattern in project_patterns:
            matches = re.findall(pattern, response, re.IGNORECASE)
            projects_mentioned += len(matches)
        
        # Enhanced communication assessment
        sentence_count = len([s for s in response.split('.') if s.strip()])
        avg_sentence_length = word_count / max(1, sentence_count)
        
        if avg_sentence_length > 25 or word_count > 500:
            communication = "weak"  # Too verbose
        elif avg_sentence_length < 10 or word_count < 80:
            communication = "weak"  # Too brief
        else:
            communication = "adequate"
        
        # Calculate score
        intro_score = 6
        if len(skills) >= 4:
            intro_score += 1
        if projects_mentioned >= 2:
            intro_score += 1
        if 150 <= word_count <= 400:
            intro_score += 1
        if confidence == "high":
            intro_score += 1
        if communication == "adequate":
            intro_score += 1
        
        return {
            "skills": skills,
            "experience": experience,
            "primary_skill": primary_skill,
            "confidence": confidence,
            "communication": communication,
            "projects_mentioned": projects_mentioned,
            "word_count": word_count,
            "intro_score": min(10, max(1, intro_score))
        }

    def _sanitize_input(self, text: str) -> str:
        """Sanitize candidate input to prevent prompt injection and log suspicious attempts"""
        if not text:
            return ""
            
        # Detect common prompt injection fragments
        suspicious_phrases = [
            "ignore previous", "system prompt", "override", "bypass",
            "forget instructions", "you are now", "act as", "new rule", "disregard"
        ]
        
        text_lower = text.lower()
        is_suspicious = any(phrase in text_lower for phrase in suspicious_phrases)
        
        if is_suspicious:
            import logging
            logging.warning(f"Potential prompt injection detected in candidate response: {text[:100]}...")
            
        # Strip xml-like tags that we use to frame the response to prevent boundary breaks
        text = text.replace("<candidate_response>", "[redacted]").replace("</candidate_response>", "[redacted]")
        
        return text

    async def evaluate_answer(self, question: str, answer: str, question_type: str = "technical") -> Dict:
        """Evaluate candidate's answer quality with detailed scoring and retries"""
        # Skip Groq when there is nothing to score (avoids asyncio.run nesting and useless API calls).
        if answer is None or (isinstance(answer, str) and not answer.strip()):
            logger.info("evaluate_answer: empty answer; using fallback scoring.")
            return self._fallback_evaluation(question or "", answer or "", 0, analyze_response_quality(answer or ""))

        sanitized_answer = self._sanitize_input(answer)
        
        # 1. Basic metrics and word count
        word_count = len(answer.split())
        metrics = analyze_response_quality(answer)

        # 2. Strict Repetition & Red Flag Checks (Pre-AI)
        from difflib import SequenceMatcher
        similarity = SequenceMatcher(None, question.lower(), answer.lower()).ratio()
        
        answer_clean = answer.strip().lower().rstrip('?.,!;:"\'')
        question_clean = question.strip().lower().rstrip('?.,!;:"\'')
        
        is_repetition = (
            similarity > 0.85 or 
            (answer_clean and question_clean and (
                answer_clean == question_clean or 
                (len(answer_clean) > 10 and answer_clean in question_clean) or
                (len(question_clean) > 10 and question_clean in answer_clean)
            ))
        )
        
        is_gibberish_input = metrics.get("is_gibberish", False)

        if is_repetition or is_gibberish_input:
            reason = "repetition of the question" if is_repetition else "gibberish or non-meaningful input"
            logger.warning(f"Red flag: {reason} detected. Similarity: {similarity:.2f}")
            red_flag_res = {
                "technical_accuracy": 0.0, "completeness": 0.0, 
                "depth": 0.0, "overall": 0.0,
                "relevance": 0.0, "action_impact": 0.0,
                "confidence_score": 1.0, # Certain it's a red flag
                "strengths": [], "weaknesses": [f"Major red flag: Answer is a {reason}."],
                "reasoning": f"Automatic detection: Candidate answer is a {reason}."
            }
            return red_flag_res

        relevance_result = await self._validate_answer_relevance(question, sanitized_answer, question_type)
        if relevance_result and not relevance_result.get("addresses_question", False):
            reason = relevance_result.get("reason") or "Answer does not address the question asked."
            logger.warning("Answer relevance gate failed: %s", reason)
            return self._zero_relevance_result(question_type, reason)

        # 3. AI Evaluation with Retry Mechanism
        max_retries = 2
        timeout_seconds = 15

        for attempt in range(max_retries + 1):
            try:
                if question_type == "behavioral":
                    # Behavioral Prompt Logic
                    prompt = f"""
                    Evaluate this behavioral interview answer using behavioral competency metrics.
                    Question: {question}
                    <candidate_response>{sanitized_answer}</candidate_response>
                    
                    Strict Constraints:
                    1. If the candidate's answer is extremely short (e.g. a single sentence definition) and lacks depth or context, cap Relevance and Action & Impact at 4.0/10.
                    2. If the candidate merely repeats the question or pastes UI metadata, assign all scores as 0.0.
                    
                    Return JSON ONLY:
                    {{
                        "Relevance": [0-10],
                        "Action & Impact": [0-10],
                        "Overall": [average],
                        "Strengths": [],
                        "Weaknesses": [],
                        "Reasoning": "1-sentence justification"
                    }}
                    """
                    system_msg = "You are an HR recruiter. Return valid JSON only."
                    
                    eval_text = await asyncio.wait_for(
                        self.ai_client.generate(prompt=prompt, system_instr=system_msg, model=MODEL_NAME),
                        timeout=timeout_seconds,
                    )
                    
                    parsed = self._safe_json_parse(eval_text)
                    if parsed:
                        return {
                            "relevance": self._bound_score(parsed.get("Relevance", 0)),
                            "action_impact": self._bound_score(parsed.get("Action & Impact", 0)),
                            "overall": self._bound_score(parsed.get("Overall", 0)),
                            "strengths": parsed.get("Strengths", []),
                            "weaknesses": parsed.get("Weaknesses", []),
                            "reasoning": parsed.get("Reasoning", "Behavioral assessment performed.")
                        }

                elif question_type == "aptitude":
                    # Aptitude Logic (simplified for AI)
                    prompt = f"Question: {question}\nAnswer: {sanitized_answer}\nIs this correct? Return JSON: {{\"Correctness\": 10 or 0, \"Reason\": \"\"}}"
                    eval_text = await asyncio.wait_for(
                        self.ai_client.generate(prompt=prompt, system_instr="Evaluator. JSON only.", model=MODEL_NAME),
                        timeout=timeout_seconds,
                    )
                    parsed = self._safe_json_parse(eval_text)
                    score = 10.0 if parsed and parsed.get("Correctness") == 10 else 0.0
                    return {
                        "overall": score, "technical_accuracy": score, "completeness": score,
                        "depth": 0.0,
                        "strengths": [parsed.get("Reason", "")] if parsed else [], "weaknesses": []
                    }

                else:
                    prompt = f"""
                    Evaluate technical answer:
                    Question: {question}
                    <candidate_response>{sanitized_answer}</candidate_response>
                    
                    Strict Constraints:
                    1. If the candidate's answer is extremely short (e.g. a single sentence definition) and lacks depth or architectural examples, cap Technical Accuracy at 4.0/10 and Depth at 2.0/10.
                    2. If the candidate merely repeats the question or pastes UI metadata, assign all scores as 0.0.
                    
                    Return JSON ONLY:
                    {{
                        "Technical Accuracy": [0-10],
                        "Completeness": [0-10],
                        "Depth": [0-10],
                        "Overall": [average],
                        "Strengths": [],
                        "Weaknesses": [],
                        "Reasoning": "1-sentence justification"
                    }}
                    """
                    system_msg = "Technical recruiter. JSON only."
                    eval_text = await asyncio.wait_for(
                        self.ai_client.generate(prompt=prompt, system_instr=system_msg, model=MODEL_NAME),
                        timeout=timeout_seconds,
                    )
                    
                    parsed = self._safe_json_parse(eval_text)
                    if parsed:
                        return {
                            "technical_accuracy": self._bound_score(parsed.get("Technical Accuracy", 0)),
                            "completeness": self._bound_score(parsed.get("Completeness", 0)),
                            "depth": self._bound_score(parsed.get("Depth", 0)),
                            "overall": self._bound_score(parsed.get("Overall", 0)),
                            "strengths": parsed.get("Strengths", []),
                            "weaknesses": parsed.get("Weaknesses", []),
                            "reasoning": parsed.get("Reasoning", "Technical validation performed.")
                        }

            except asyncio.TimeoutError:
                logger.warning(f"AI Evaluation timeout (Attempt {attempt + 1}/{max_retries + 1})")
            except Exception as e:
                logger.error(f"AI Evaluation error (Attempt {attempt + 1}): {e}")
            
            if attempt < max_retries:
                await asyncio.sleep(1)  # Short backoff (must not use asyncio.run inside FastAPI workers)

        # 4. Final Fallback if all retries fail
        logger.error("All AI evaluation attempts failed. Using fallback scoring.")
        if question_type == "behavioral":
            return self._fallback_behavioral_evaluation(word_count)
        return self._fallback_evaluation(question, answer, word_count, metrics)

    async def _validate_answer_relevance(self, question: str, answer: str, question_type: str) -> Dict | None:
        """Strict pre-score gate: does this answer address this exact question?"""
        if is_ai_unavailable_response(answer):
            return None

        if answer.strip().endswith("?") and re.match(r"^(what|how|why|when|where|which|who|does|do|is|are|can)\b", answer.strip().lower()):
            return {
                "addresses_question": False,
                "relevance_score": 0.0,
                "reason": "Candidate answered with a different question instead of responding."
            }

        prompt = f"""
        Decide whether the candidate response directly answers the interview question.

        Question type: {question_type}
        Question: {question}
        <candidate_response>{answer}</candidate_response>

        Strict rules:
        - Return addresses_question=false if the response answers a different question.
        - Return false if it is merely in the same broad domain but does not address the requested concept, role, action, or impact.
        - For behavioral questions, the response must address the requested experience/situation, role, action, and contribution.
        - For technical questions, the response must address the requested technical concept.
        - Strict Rule: If the response consists primarily of the question text or platform UI metadata (e.g., 'Current Question', 'Medium Round'), you must return addresses_question=false.

        Return JSON ONLY:
        {{
          "addresses_question": true/false,
          "relevance_score": 0-10,
          "reason": "short reason"
        }}
        """
        try:
            gate_text = await asyncio.wait_for(
                self.ai_client.generate(
                    prompt=prompt,
                    system_instr="Strict interview relevance validator. Return valid JSON only.",
                    model=MODEL_NAME,
                ),
                timeout=10,
            )
            parsed = self._safe_json_parse(gate_text)
            if not parsed:
                return None
            relevance_score = self._bound_score(parsed.get("relevance_score", parsed.get("Relevance Score", 0)))
            addresses = bool(parsed.get("addresses_question", parsed.get("Addresses Question", False)))
            if relevance_score <= 2:
                addresses = False
            return {
                "addresses_question": addresses,
                "relevance_score": relevance_score,
                "reason": parsed.get("reason", parsed.get("Reason", "")),
            }
        except Exception as e:
            logger.warning(f"Answer relevance gate unavailable: {e}")
            return None

    def _zero_relevance_result(self, question_type: str, reason: str) -> Dict:
        base = {
            "overall": 0.0,
            "confidence_score": 1.0,
            "strengths": [],
            "weaknesses": [reason],
            "reasoning": reason,
        }
        if question_type == "behavioral":
            base.update({"relevance": 0.0, "action_impact": 0.0, "depth": 0.0})
        else:
            base.update({"technical_accuracy": 0.0, "completeness": 0.0, "depth": 0.0, "relevance": 0.0})
        return base

    def _safe_json_parse(self, text: str) -> Dict:
        """Clean and parse JSON from AI response"""
        if is_ai_unavailable_response(text):
            return {}
        if not text:
            return {}
        try:
            import json as _json
            # Remove markdown blocks
            cleaned = text.replace("```json", "").replace("```", "").strip()
            # Find the first { and last }
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start != -1 and end != -1:
                return _json.loads(cleaned[start:end+1])
        except:
            pass
        return {}

    def _bound_score(self, score) -> float:
        """Ensure score is a float between 0 and 10"""
        try:
            val = float(score)
            if val != val: return 0.0 # NaN check
            return round(max(0.0, min(10.0, val)), 1)
        except:
            return 0.0

    @staticmethod
    def _parse_score(text: str) -> float:
        """Extract the first numeric value (int or float) from a string.
        Handles cases like '1 (very low)', '1/10', '1.5 — poor', etc."""
        match = re.search(r'\b(\d+(?:\.\d+)?)\b', text.strip())
        if match:
            return float(match.group(1))
        raise ValueError(f"No numeric score found in: {text!r}")

    def _parse_detailed_evaluation(self, eval_text: str, word_count: int, metrics: Dict) -> Dict:
        """Parse detailed AI evaluation"""
        scores = {
            "technical_accuracy": 0,
            "completeness": 0,
            "depth": 0,
            "overall": 0,
            "strengths": [],
            "weaknesses": []
        }
        
        lines = eval_text.strip().split('\n')
        strengths_found = False
        weaknesses_found = False
        
        for line in lines:
            line_lower = line.lower().strip()
            
            # Parse scores
            if "technical accuracy:" in line_lower:
                try:
                    scores["technical_accuracy"] = self._parse_score(line.split(":", 1)[1])
                except:
                    pass
            elif "completeness:" in line_lower:
                try:
                    scores["completeness"] = self._parse_score(line.split(":", 1)[1])
                except:
                    pass
            elif "depth:" in line_lower:
                try:
                    scores["depth"] = self._parse_score(line.split(":", 1)[1])
                except:
                    pass
            elif "overall:" in line_lower:
                try:
                    scores["overall"] = self._parse_score(line.split(":", 1)[1])
                except:
                    pass
            
            # Parse strengths and weaknesses
            elif "strengths:" in line_lower:
                strengths_found = True
                weaknesses_found = False
                strength_text = line.split(":", 1)[1].strip()
                if strength_text:
                    scores["strengths"].append(strength_text)
            elif "weaknesses:" in line_lower:
                strengths_found = False
                weaknesses_found = True
                weakness_text = line.split(":", 1)[1].strip()
                if weakness_text:
                    scores["weaknesses"].append(weakness_text)
            elif strengths_found and line_lower and not line_lower.startswith(("technical", "completeness", "depth", "overall", "weaknesses")):
                scores["strengths"].append(line.strip())
            elif weaknesses_found and line_lower and not line_lower.startswith(("technical", "completeness", "depth", "overall", "strengths")):
                scores["weaknesses"].append(line.strip())
        
        # Adjust based on word count (80-200 words ideal for technical answers)
        if 80 <= word_count <= 200:
            scores["completeness"] = min(10, scores["completeness"] + 1)
            scores["overall"] = min(10, (sum([scores["technical_accuracy"], scores["completeness"], 
                                            scores["depth"]]) / 3))
        elif word_count < 50:
            scores["completeness"] = max(0, scores["completeness"] - 2)
            scores["overall"] = max(0, scores["overall"] - 1)
        
        if metrics["has_technical_terms"]:
            scores["technical_accuracy"] = min(10, scores["technical_accuracy"] + 0.5)
        
        # Ensure overall is average of categories
        category_scores = [scores["technical_accuracy"], scores["completeness"], scores["depth"]]
        scores["overall"] = sum(category_scores) / len(category_scores)
        
        # Raise error if everything is 0 to trigger overall fallback safety layouts
        # Raise error if everything is 0 ONLY if no red flags are mentioned
        if scores["overall"] == 0 and not any("red flag" in str(w).lower() for w in scores.get("weaknesses", [])):
            raise ValueError("Parsed score is 0.0 across categories, likely parsing failed setup")

        # Round scores
        for key in scores:
            if isinstance(scores[key], (int, float)):
                scores[key] = round(scores[key], 1)
        return scores

    def _parse_behavioral_evaluation(self, eval_text: str, word_count: int) -> Dict:
        """Parse behavioral AI evaluation with competency metrics"""
        scores = {
            "relevance": 0.0,
            "action_impact": 0.0,
            "overall": 0.0,
            "strengths": [],
            "weaknesses": []
        }
        
        lines = eval_text.strip().split('\n')
        strengths_found = False
        weaknesses_found = False
        
        for line in lines:
            line_lower = line.lower().strip()
            
            # Parse scores
            if "relevance:" in line_lower:
                try: scores["relevance"] = self._parse_score(line.split(":", 1)[1])
                except: pass
            elif "action" in line_lower and "impact" in line_lower:
                try: scores["action_impact"] = self._parse_score(line.split(":", 1)[1])
                except: pass
            elif "overall:" in line_lower:
                try: scores["overall"] = self._parse_score(line.split(":", 1)[1])
                except: pass
            
            # Parse strengths and weaknesses
            elif "strengths:" in line_lower:
                strengths_found = True
                weaknesses_found = False
                strength_text = line.split(":", 1)[1].strip()
                if strength_text:
                    scores["strengths"].append(strength_text)
            elif "weaknesses:" in line_lower:
                strengths_found = False
                weaknesses_found = True
                weakness_text = line.split(":", 1)[1].strip()
                if weakness_text:
                    scores["weaknesses"].append(weakness_text)
            elif strengths_found and line_lower and not line_lower.startswith(("communication", "coherence", "empathy", "situational", "self", "overall", "weaknesses")):
                scores["strengths"].append(line.strip())
            elif weaknesses_found and line_lower and not line_lower.startswith(("communication", "coherence", "empathy", "situational", "self", "overall", "strengths")):
                scores["weaknesses"].append(line.strip())
        
        category_scores = [scores["relevance"], scores["action_impact"]]
        scores["overall"] = sum(category_scores) / len(category_scores)
        
        for key in scores:
            if isinstance(scores[key], (int, float)):
                scores[key] = round(scores[key], 1)
        
        return scores

    def _fallback_evaluation(self, question: str, answer: str, word_count: int, metrics: Dict) -> Dict:
        """Fallback evaluation when AI fails"""
        base_score = 5
        
        # Adjust based on word count
        if 100 <= word_count <= 250:
            base_score = 7
        elif 50 <= word_count < 100:
            base_score = 6
        elif word_count < 50:
            base_score = 4
        elif word_count > 300:
            base_score = 6  # Might be too verbose
        
        # Adjust based on metrics
        if metrics["has_examples"]:
            base_score += 1
        if metrics["has_technical_terms"]:
            base_score += 1
        if metrics["has_explanation"]:
            base_score += 1
        
        # Check for question-specific indicators
        answer_lower = answer.lower()
        question_lower = question.lower()
        
        if "debug" in question_lower and any(term in answer_lower for term in ["log", "monitor", "analyze", "profile"]):
            base_score += 1
        
        if "design" in question_lower and any(term in answer_lower for term in ["scalable", "architecture", "components", "trade-off"]):
            base_score += 1
        
        if "difference between" in question_lower and any(term in answer_lower for term in ["vs", "versus", "while", "whereas", "on the other hand"]):
            base_score += 1
        
        # Cap score
        final_score = max(1, min(10, base_score))
        
        # Generate simple strengths/weaknesses
        strengths = []
        weaknesses = []
        
        if word_count >= 100:
            strengths.append("Provides detailed explanations")
        else:
            weaknesses.append("Could provide more detail")
        
        if metrics["has_examples"]:
            strengths.append("Uses practical examples")
        else:
            weaknesses.append("Lacks concrete examples")
        
        return {
            "technical_accuracy": final_score,
            "completeness": final_score,
            "depth": final_score,
            "overall": final_score,
            "strengths": strengths[:2],
            "weaknesses": weaknesses[:2]
        }

    def _fallback_behavioral_evaluation(self, word_count: int) -> Dict:
        """Fallback evaluation for behavioral questions when AI fails"""
        base_score = 5
        if 80 <= word_count <= 250:
            base_score = 7
        if word_count < 50:
            base_score = 0  # Severe penalty for extremely short or repeated question
            
        return {
            "relevance": base_score,
            "action_impact": base_score,
            "overall": base_score,
            "strengths": ["Answered the question"] if word_count >= 50 else [],
            "weaknesses": ["Could provide more detail"] if word_count < 100 else []
        }

    def check_for_termination(self, response: str, question_type: str = "technical") -> Tuple[bool, str]:
        """Check if interview should be terminated"""
        from .config import ABUSIVE_KEYWORDS, TERMINATION_KEYWORDS
        
        if not response or response.isspace():
            return False, ""
        
        response_lower = response.lower().strip()
        
        # Check for abusive language
        for keyword in ABUSIVE_KEYWORDS:
            if keyword in response_lower:
                return True, "misconduct"
        
        # Check for explicit termination request
        # Use regex to match whole words only to avoid false positives (e.g., "backend" matching "end")
        for keyword in TERMINATION_KEYWORDS:
            if re.search(r'\b' + re.escape(keyword) + r'\b', response_lower):
                return True, "candidate_request"
        
        # Check for extremely poor or gibberish responses
        # We only terminate for gibberish if it's substantial (not just a short typo)
        if len(response_lower) > 50:
            from .utils import is_gibberish
            if is_gibberish(response):
                return True, "misconduct" # Gibberish is treated as misconduct/non-serious attempt
        
        return False, ""
    
    async def analyze_introduction(self, response: str, job_title: str = "") -> Dict:
        """Analyze candidate's introduction with better AI analysis and job context"""
        from .config import SKILL_CATEGORIES
        categories = list(SKILL_CATEGORIES.keys())
        
        job_context = f"This is for the position of '{job_title}'." if job_title else ""
        
        prompt = f"""
            Analyze the candidate's introduction as a technical recruiter.
            {job_context}
            
            Candidate Data/Summary:
            {response[:1000]}

            Evaluation guidelines:
            - Be fair and slightly liberal in interpretation, but do NOT overestimate the
              candidate’s skills, experience, or confidence beyond what is clearly stated.
            - Base all judgments strictly on the content provided.
            - Assume a junior-to-mid level candidate unless strong evidence suggests otherwise.
            - Avoid generic assumptions or exaggerated classifications.

            Provide the analysis in EXACTLY the following format:

            Skills: [comma-separated list of specific technical skills explicitly mentioned or strongly implied]
            Experience Level: [junior/mid/senior]
            Primary Technical Area: [{"/".join(categories)}]
            Confidence: [low/medium/high]
            Communication: [weak/adequate/strong]
            Projects Mentioned: [number]
        """
        
        try:
            logger.debug("Sending introduction text to AI for analysis (job_title=%s)", job_title or "none")
            
            system_instr = '''
                    You are a technical recruiter evaluating candidate responses during an interview. Analyze each answer carefully and provide specific, detailed, and objective feedback based strictly on the content provided.
                    Evaluate the candidate liberally and fairly, recognizing effort, clarity, and correct reasoning, but do not inflate scores or assessments beyond what the response genuinely demonstrates.
                    The interview difficulty level should be considered medium, so expectations should align with a competent junior-to-mid-level candidate rather than an expert.
                    Focus your evaluation on:
                    Technical correctness and conceptual understanding
                    Clarity of explanation and communication
                    Practical thinking and real-world relevance
                    Completeness of the response relative to the question
                    Be balanced in your judgment: acknowledge strengths clearly, point out gaps constructively, and avoid overly harsh or overly generous evaluations. The goal is to provide a realistic assessment of the candidate’s readiness at a medium-level technical interview. 
            '''
            
            analysis_text = await self.ai_client.generate(
                prompt=prompt,
                system_instr=system_instr,
                model=MODEL_NAME
            )
            
            if is_ai_unavailable_response(analysis_text):
                logger.warning("Introduction analysis: AI unavailable; using enhanced fallback.")
                return self._enhanced_fallback_analysis(response)
            
            return self._parse_intro_analysis(analysis_text, response)
        except Exception as e:
            logger.warning("AI introduction analysis error: %s", e)
            return self._enhanced_fallback_analysis(response)
