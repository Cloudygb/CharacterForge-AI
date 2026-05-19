.PHONY: install test coverage lint format clean

PYTHON ?= python3
RUFF_PATHS ?= src tests examples scripts

install:
	$(PYTHON) -m pip install -e ".[dev]"

test:
	$(PYTHON) -m pytest -v

coverage:
	$(PYTHON) -m pytest --cov=characterforge --cov-report=term-missing

lint:
	ruff check $(RUFF_PATHS)

format:
	ruff format $(RUFF_PATHS)

clean:
	rm -rf .pytest_cache .ruff_cache .coverage htmlcov build dist *.egg-info

