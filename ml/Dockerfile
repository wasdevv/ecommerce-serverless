# Servidor local do recomendador (contrato do container SageMaker: /ping e
# /invocations na porta 8080). Só biblioteca padrão: nada para instalar.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/program
COPY recommender ./recommender

# O modelo mora num volume em /opt/ml/model, o mesmo caminho em que o
# SageMaker descompacta o model.tar.gz.
RUN mkdir -p /opt/ml/model && chown nobody /opt/ml/model
USER nobody
EXPOSE 8080
HEALTHCHECK --interval=5s --retries=10 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/ping', timeout=2)"]
CMD ["python", "-m", "recommender.serve", "--model-dir", "/opt/ml/model", "--port", "8080"]
