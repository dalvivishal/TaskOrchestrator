from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import db, models
from app.api.dependencies import get_current_user
from pydantic import BaseModel
import threading
from app.agents.crew import run_orchestrator_job

router = APIRouter()

class JobCreate(BaseModel):
    prompt: str

@router.post("/")
def create_job(job_req: JobCreate, background_tasks: BackgroundTasks, current_user: models.User = Depends(get_current_user), database: Session = Depends(db.get_db)):
    # Create the job in the database
    new_job = models.Job(user_id=current_user.id, prompt=job_req.prompt, status=models.JobStatus.PENDING)
    database.add(new_job)
    database.commit()
    database.refresh(new_job)
    
    # Run the crewAI job in the background
    background_tasks.add_task(run_orchestrator_job, new_job.id)
    
    return {"message": "Job started", "job_id": new_job.id}

@router.get("/")
def list_jobs(current_user: models.User = Depends(get_current_user), database: Session = Depends(db.get_db)):
    jobs = database.query(models.Job).filter(models.Job.user_id == current_user.id).order_by(models.Job.created_at.desc()).all()
    return [{"id": job.id, "prompt": job.prompt, "status": job.status.value, "created_at": job.created_at} for job in jobs]

@router.get("/{job_id}")
def get_job(job_id: int, current_user: models.User = Depends(get_current_user), database: Session = Depends(db.get_db)):
    job = database.query(models.Job).filter(models.Job.id == job_id, models.Job.user_id == current_user.id).first()
    if not job:
        return {"error": "Job not found"}
    
    logs = [{"agent": log.agent_name, "action": log.action, "payload": log.payload, "created_at": log.created_at} for log in job.logs]
    doc = {"id": job.document.id, "content": job.document.content, "status": job.document.status} if job.document else None
    
    return {
        "id": job.id,
        "prompt": job.prompt,
        "status": job.status.value,
        "created_at": job.created_at,
        "logs": logs,
        "document": doc
    }

class DocumentUpdate(BaseModel):
    content: str
    status: str

@router.put("/{job_id}/document")
def update_document(job_id: int, doc_update: DocumentUpdate, current_user: models.User = Depends(get_current_user), database: Session = Depends(db.get_db)):
    job = database.query(models.Job).filter(models.Job.id == job_id, models.Job.user_id == current_user.id).first()
    if not job or not job.document:
        return {"error": "Job or Document not found"}
    
    job.document.content = doc_update.content
    job.document.status = doc_update.status
    database.commit()
    
    return {"message": "Document updated"}
