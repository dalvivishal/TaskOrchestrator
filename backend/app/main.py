from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import db, models
from app.api import auth, jobs

# Create database tables
models.Base.metadata.create_all(bind=db.engine)

app = FastAPI(title="Multi-Agent Task Orchestrator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], # Vite default
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["Auth"])
app.include_router(jobs.router, prefix="/jobs", tags=["Jobs"])

@app.get("/")
def root():
    return {"message": "Welcome to the Multi-Agent Task Orchestrator API"}
