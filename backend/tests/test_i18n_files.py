"""The app's words: English first, every language complete, nothing missing.

A key the code uses but English lacks shows as a raw key on a barber's phone;
a placeholder lost in translation shows a sentence without the name or date.
"""
import json
import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
I18N = ROOT / "frontend/public/i18n"
APP = ROOT / "frontend/src/app"
FORM = Path(__file__).resolve().parents[1] / "manifests/forms/intake.yaml"

pytestmark = pytest.mark.skipif(not I18N.exists(), reason="frontend sources not present")


def load(code):
    return json.loads((I18N / f"{code}.json").read_text())


def config():
    return json.loads((I18N / "languages.json").read_text())


def test_english_first_and_default():
    cfg = config()
    assert cfg["default"] == "en" and cfg["languages"][0]["code"] == "en"


def test_every_enabled_language_is_complete():
    en = set(load("en"))
    for code in config()["enabled"]:
        assert set(load(code)) == en, f"{code}: missing {sorted(en - set(load(code)))[:5]}"


def test_placeholders_survive_translation():
    en = load("en")
    for code in config()["enabled"]:
        for key, text in load(code).items():
            for ph in re.findall(r"\{\w+\}", en[key]):
                assert ph in text, f"{code}:{key} lost {ph}"


def test_every_literal_key_in_the_code_exists():
    en = set(load("en"))
    used = set()
    for path in APP.rglob("*.ts"):
        used |= set(re.findall(r"(?:t|tr)\(\)\('([a-zA-Z0-9_.-]+)'[,)]", path.read_text()))
    assert used and used <= en, sorted(used - en)


def test_every_question_and_option_has_words():
    en = load("en")
    form = yaml.safe_load(FORM.read_text())
    for section in form["sections"]:
        assert f"section.{section['id']}" in en, section["id"]
        for f in section["fields"]:
            assert f"form.{f['id']}" in en, f["id"]
            for o in f.get("options", []):
                if not re.fullmatch(r"[\d–+\- ]+", o["label"]):
                    assert f"form.{f['id']}.{o['value']}" in en, (f["id"], o["value"])


def test_every_agent_step_has_a_name():
    en = load("en")
    wf = yaml.safe_load((FORM.parents[1] / "workflows/consultation.yaml").read_text())
    for step in wf["steps"]:
        assert f"agent.{step['id']}" in en, step["id"]
