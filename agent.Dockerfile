FROM python:3.10-slim
WORKDIR /app
COPY sdk/requirements.txt /app/sdk/requirements.txt
RUN pip install --require-hashes -r /app/sdk/requirements.txt
COPY sdk/ /app/sdk/
COPY tests/ /app/tests/
CMD ["tail", "-f", "/dev/null"]
