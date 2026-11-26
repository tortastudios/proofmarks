import os
from pathlib import Path
import markdown
from fastapi import FastAPI, Request
from fastapi.templating import Jinja2Templates

app = FastAPI()
root = Path(__file__).parent
templates = Jinja2Templates(directory=str(root / "templates"))

@app.get("/")
@app.get("/template")
def index(request: Request):
    essay = markdown.markdown((root / "content/essay.md").read_text())
    return templates.TemplateResponse(request=request, name="page.html", context={"proofmarks_origin": os.getenv("PROOFMARKS_ORIGIN", "http://127.0.0.1:4848"), "essay": essay, "dev": os.getenv("APP_ENV") == "development", "script": os.getenv("PROOFMARKS_SCRIPT") == "1", "template_page": request.url.path == "/template", "extra": "Bring your notebook."})
