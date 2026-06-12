from . import polly, bark, coqui, vits, chattts, tortoise

ENGINES: dict[str, dict] = {
    "polly":   {"info": polly.INFO,   "fn": polly.synthesize},
    "bark":    {"info": bark.INFO,    "fn": bark.synthesize},
    "coqui":   {"info": coqui.INFO,   "fn": coqui.synthesize},
    "vits":    {"info": vits.INFO,    "fn": vits.synthesize},
    "chattts": {"info": chattts.INFO, "fn": chattts.synthesize},
    "tortoise":{"info": tortoise.INFO,"fn": tortoise.synthesize},
}
