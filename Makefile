.PHONY: install test coverage lint format clean

PYTHON ?= python3

install:
	$(PYTHON) -m pip install -e ".[dev]"

test:
	$(PYTHON) -m pytest -v

coverage:
	$(PYTHON) -m pytest --cov=characterforge --cov-report=term-missing

lint:
	ruff check src tests examples

format:
	ruff format src tests examples

clean:
	rm -rf .pytest_cache .ruff_cache .coverage htmlcov build dist *.egg-info

