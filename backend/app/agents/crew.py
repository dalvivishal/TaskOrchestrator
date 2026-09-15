from crewai import Agent, Task, Crew, Process
from app.agents.tools import mock_gmail_sender, mock_click2mail_dispatcher, web_search_emulator
from app.database import db, models
import json

import os
from dotenv import load_dotenv

load_dotenv()
if not os.environ.get("OPENAI_API_KEY"):
    # Set a dummy key just so it initializes if not present (requires real key for true execution)
    os.environ["OPENAI_API_KEY"] = "sk-mock-key-for-testing"

def run_orchestrator_job(job_id: int):
    database = next(db.get_db())
    job = database.query(models.Job).filter(models.Job.id == job_id).first()
    if not job:
        return
        
    job.status = models.JobStatus.IN_PROGRESS
    database.commit()

    def step_callback(step_output):
        # A simple callback to log the step to the DB
        # step_output could be a tuple or object depending on CrewAI version
        payload = str(step_output)
        log = models.AgentLog(
            job_id=job.id,
            agent_name="CrewAI Agent",
            action="Executed Step",
            payload=payload[:1000] # truncating if too large
        )
        database.add(log)
        database.commit()

    try:
        manager = Agent(
            role="Orchestrator Manager",
            goal="Understand user requests and delegate tasks to the right workers.",
            backstory="A seasoned project manager who knows how to coordinate research, writing, and dispatching.",
            allow_delegation=True,
            verbose=True
        )

        researcher = Agent(
            role="Data Researcher",
            goal="Gather necessary information using web search tools.",
            backstory="An expert investigator.",
            tools=[web_search_emulator],
            allow_delegation=False,
            verbose=True
        )

        writer = Agent(
            role="Document Writer",
            goal="Draft documents based on the researcher's findings.",
            backstory="A skilled content writer who formats information beautifully.",
            allow_delegation=False,
            verbose=True
        )

        dispatcher = Agent(
            role="Communication Dispatcher",
            goal="Send the drafted documents via email or physical mail using tools.",
            backstory="A logistics expert who handles the final delivery of messages.",
            tools=[mock_gmail_sender, mock_click2mail_dispatcher],
            allow_delegation=False,
            verbose=True
        )

        # In a real dynamic scenario, the manager would break down the prompt.
        # Here we define a set of tasks that flow through the agents based on the user's prompt.
        task1 = Task(
            description=f"Analyze this request and extract required research: {job.prompt}",
            expected_output="A list of required data points.",
            agent=researcher
        )
        task2 = Task(
            description="Draft a professional document or email body using the research data.",
            expected_output="A fully formatted document text.",
            agent=writer
        )
        task3 = Task(
            description="If the prompt requires sending an email or letter, use the dispatcher tools to send the document drafted by the writer. Return the final status.",
            expected_output="Dispatch status confirmation.",
            agent=dispatcher
        )

        crew = Crew(
            agents=[manager, researcher, writer, dispatcher],
            tasks=[task1, task2, task3],
            process=Process.sequential,
            step_callback=step_callback
        )

        result = crew.kickoff()
        
        # Save generated document
        doc = models.Document(job_id=job.id, content=str(result), status="DRAFT")
        database.add(doc)
        
        job.status = models.JobStatus.COMPLETED
        database.commit()
    except Exception as e:
        job.status = models.JobStatus.FAILED
        log = models.AgentLog(job_id=job.id, agent_name="System", action="Error", payload=str(e))
        database.add(log)
        database.commit()
    finally:
        database.close()
