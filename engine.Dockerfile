# Stage 1: Build the React Enterprise Portal
FROM node:22-alpine AS ui-build
WORKDIR /app/platform
COPY platform/package*.json ./
RUN npm install
COPY platform/ ./
RUN npm run build

# Stage 2: Build the Go Master Engine
FROM golang:alpine AS engine-build
WORKDIR /app/engine
RUN apk add --no-cache git
COPY engine/ ./
RUN go mod download
RUN go build -o atp_engine main.go

# Stage 3: Final lightweight image
FROM alpine:latest
WORKDIR /app/engine
COPY --from=engine-build /app/engine/atp_engine .
COPY --from=engine-build /app/engine/policy.yaml .
COPY --from=ui-build /app/platform/dist ./dist
CMD ["./atp_engine"]
