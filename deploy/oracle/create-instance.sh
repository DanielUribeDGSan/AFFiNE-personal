#!/usr/bin/env bash
# Ejecutar en Oracle Cloud Shell (ya autenticado).
# Crea VCN + reglas + VM Always Free Ampere A1 e instala Docker + AFFiNE.
set -euo pipefail

DISPLAY_NAME="${DISPLAY_NAME:-affine-web}"
SHAPE="${SHAPE:-VM.Standard.A1.Flex}"
OCPUS="${OCPUS:-2}"
MEMORY_GB="${MEMORY_GB:-12}"
BOOT_GB="${BOOT_GB:-50}"

SSH_PUBLIC_KEY="${SSH_PUBLIC_KEY:-ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOlB8BxrHI8sqdjjXmC/HFrHqXEJozHjae03Vi5EZF7T daniel.uribe@babelgroup.com}"

COMPARTMENT_ID="${COMPARTMENT_ID:-${OCI_TENANCY:-}}"
if [[ -z "${COMPARTMENT_ID}" ]]; then
  COMPARTMENT_ID="$(oci iam compartment list --all --compartment-id-in-subtree true --access-level ACCESSIBLE --include-root \
    --query "data[?\"compartment-id\"==null].id | [0]" --raw-output)"
fi
echo "==> Compartment: ${COMPARTMENT_ID}"

AD_LIST=()
while IFS= read -r line; do
  [[ -n "${line}" ]] && AD_LIST+=("${line}")
done < <(oci iam availability-domain list --compartment-id "${COMPARTMENT_ID}" --query 'data[].name' --output json \
  | python3 -c 'import sys,json; print("\n".join(json.load(sys.stdin)))')
echo "==> ADs: ${AD_LIST[*]}"

IMAGE_ID="$(oci compute image list \
  --compartment-id "${COMPARTMENT_ID}" \
  --operating-system "Canonical Ubuntu" \
  --operating-system-version "22.04" \
  --shape "${SHAPE}" \
  --sort-by TIMECREATED --sort-order DESC \
  --query 'data[0].id' --raw-output)"
echo "==> Image: ${IMAGE_ID}"

VCN_NAME="affine-vcn"
SUBNET_NAME="affine-public-subnet"
IGW_NAME="affine-igw"
SL_NAME="affine-sl"

EXISTING_VCN="$(oci network vcn list --compartment-id "${COMPARTMENT_ID}" --display-name "${VCN_NAME}" \
  --query 'data[0].id' --raw-output 2>/dev/null || true)"
if [[ -z "${EXISTING_VCN}" || "${EXISTING_VCN}" == "null" ]]; then
  echo "==> Creando VCN..."
  VCN_ID="$(oci network vcn create \
    --compartment-id "${COMPARTMENT_ID}" \
    --display-name "${VCN_NAME}" \
    --cidr-blocks '["10.0.0.0/16"]' \
    --dns-label affinevcn \
    --wait-for-state AVAILABLE \
    --query 'data.id' --raw-output)"
else
  VCN_ID="${EXISTING_VCN}"
  echo "==> Reusando VCN: ${VCN_ID}"
fi

EXISTING_IGW="$(oci network internet-gateway list --compartment-id "${COMPARTMENT_ID}" --vcn-id "${VCN_ID}" \
  --query 'data[0].id' --raw-output 2>/dev/null || true)"
if [[ -z "${EXISTING_IGW}" || "${EXISTING_IGW}" == "null" ]]; then
  IGW_ID="$(oci network internet-gateway create \
    --compartment-id "${COMPARTMENT_ID}" \
    --vcn-id "${VCN_ID}" \
    --display-name "${IGW_NAME}" \
    --is-enabled true \
    --wait-for-state AVAILABLE \
    --query 'data.id' --raw-output)"
else
  IGW_ID="${EXISTING_IGW}"
fi

RT_ID="$(oci network route-table list --compartment-id "${COMPARTMENT_ID}" --vcn-id "${VCN_ID}" \
  --query 'data[0].id' --raw-output)"
oci network route-table update --rt-id "${RT_ID}" --force \
  --route-rules "[{\"cidrBlock\":\"0.0.0.0/0\",\"networkEntityId\":\"${IGW_ID}\"}]" \
  --wait-for-state AVAILABLE >/dev/null

EXISTING_SL="$(oci network security-list list --compartment-id "${COMPARTMENT_ID}" --vcn-id "${VCN_ID}" \
  --display-name "${SL_NAME}" --query 'data[0].id' --raw-output 2>/dev/null || true)"
if [[ -z "${EXISTING_SL}" || "${EXISTING_SL}" == "null" ]]; then
  SL_ID="$(oci network security-list create \
    --compartment-id "${COMPARTMENT_ID}" \
    --vcn-id "${VCN_ID}" \
    --display-name "${SL_NAME}" \
    --egress-security-rules '[{"destination":"0.0.0.0/0","protocol":"all","isStateless":false}]' \
    --ingress-security-rules '[
      {"source":"0.0.0.0/0","protocol":"6","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},
      {"source":"0.0.0.0/0","protocol":"6","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},
      {"source":"0.0.0.0/0","protocol":"6","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":443,"max":443}}},
      {"source":"0.0.0.0/0","protocol":"6","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":3010,"max":3010}}},
      {"source":"0.0.0.0/0","protocol":"1","isStateless":false,"icmpOptions":{"type":3,"code":4}}
    ]' \
    --wait-for-state AVAILABLE \
    --query 'data.id' --raw-output)"
else
  SL_ID="${EXISTING_SL}"
fi

EXISTING_SUBNET="$(oci network subnet list --compartment-id "${COMPARTMENT_ID}" --vcn-id "${VCN_ID}" \
  --display-name "${SUBNET_NAME}" --query 'data[0].id' --raw-output 2>/dev/null || true)"
if [[ -z "${EXISTING_SUBNET}" || "${EXISTING_SUBNET}" == "null" ]]; then
  SUBNET_ID="$(oci network subnet create \
    --compartment-id "${COMPARTMENT_ID}" \
    --vcn-id "${VCN_ID}" \
    --display-name "${SUBNET_NAME}" \
    --cidr-block "10.0.1.0/24" \
    --dns-label affinepub \
    --route-table-id "${RT_ID}" \
    --security-list-ids "[\"${SL_ID}\"]" \
    --prohibit-public-ip-on-vnic false \
    --wait-for-state AVAILABLE \
    --query 'data.id' --raw-output)"
else
  SUBNET_ID="${EXISTING_SUBNET}"
fi
echo "==> Subnet: ${SUBNET_ID}"

CLOUD_INIT=$(cat <<'CLOUD'
#cloud-config
package_update: true
packages:
  - ca-certificates
  - curl
  - gnupg
  - jq
  - python3
write_files:
  - path: /usr/local/bin/affine-bootstrap.sh
    permissions: '0755'
    content: |
      #!/usr/bin/env bash
      set -eux
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      chmod a+r /etc/apt/keyrings/docker.gpg
      . /etc/os-release
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
      apt-get update
      DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
      usermod -aG docker ubuntu
      mkdir -p /opt/affine/config /opt/affine/data/postgres /opt/affine/data/storage
      chown -R ubuntu:ubuntu /opt/affine
      PUBLIC_IP=$(curl -fsS -H "Authorization: Bearer Oracle" http://169.254.169.254/opc/v2/vnics/ | jq -r '.[0].publicIp // empty')
      if [ -z "$PUBLIC_IP" ]; then PUBLIC_IP=$(curl -fsS https://ifconfig.me); fi
      EXTERNAL_URL="http://${PUBLIC_IP}:3010"
      curl -fsSL -o /opt/affine/docker-compose.yml https://github.com/toeverything/AFFiNE/releases/latest/download/docker-compose.yml
      python3 -c "import json; cfg={'deployment':{'type':'selfhosted'},'server':{'name':'AFFiNE Personal','externalUrl':'${EXTERNAL_URL}'},'copilot':{'enabled':True,'byok':{'enabled':True,'allowCustomEndpoint':True}},'indexer':{'enabled':True,'provider.type':'embedded'}}; open('/opt/affine/config/config.json','w').write(json.dumps(cfg, indent=2))"
      cd /opt/affine
      docker compose pull
      docker compose up -d
      echo "$EXTERNAL_URL" > /opt/affine/URL.txt
runcmd:
  - /usr/local/bin/affine-bootstrap.sh
CLOUD
)

USER_DATA="$(printf '%s' "${CLOUD_INIT}" | base64 | tr -d '\n')"

INSTANCE_ID=""
LAST_ERR=""
for AD in "${AD_LIST[@]}"; do
  echo "==> Intentando crear instancia en ${AD} (${OCPUS} OCPU / ${MEMORY_GB} GB)..."
  set +e
  OUT="$(oci compute instance launch \
    --compartment-id "${COMPARTMENT_ID}" \
    --availability-domain "${AD}" \
    --display-name "${DISPLAY_NAME}" \
    --shape "${SHAPE}" \
    --shape-config "{\"ocpus\":${OCPUS},\"memoryInGBs\":${MEMORY_GB}}" \
    --image-id "${IMAGE_ID}" \
    --subnet-id "${SUBNET_ID}" \
    --assign-public-ip true \
    --metadata "{\"ssh_authorized_keys\":\"${SSH_PUBLIC_KEY}\",\"user_data\":\"${USER_DATA}\"}" \
    --boot-volume-size-in-gbs "${BOOT_GB}" \
    --wait-for-state RUNNING \
    --max-wait-seconds 1200 \
    --query 'data.id' --raw-output 2>&1)"
  RC=$?
  set -e
  if [[ ${RC} -eq 0 && "${OUT}" == ocid1.instance* ]]; then
    INSTANCE_ID="${OUT}"
    echo "==> Instancia creada: ${INSTANCE_ID}"
    break
  fi
  LAST_ERR="${OUT}"
  echo "!! Falló en ${AD}:"
  echo "${OUT}"
done

if [[ -z "${INSTANCE_ID}" ]]; then
  echo
  echo "No se pudo crear la VM Ampere A1 (a menudo por capacidad Free Tier)."
  echo "Reintenta con: OCPUS=1 MEMORY_GB=6 bash create-instance.sh"
  echo "Último error: ${LAST_ERR}"
  exit 1
fi

PUBLIC_IP=""
for _ in $(seq 1 30); do
  PUBLIC_IP="$(oci compute instance list-vnics --instance-id "${INSTANCE_ID}" \
    --query 'data[0]."public-ip"' --raw-output 2>/dev/null || true)"
  if [[ -n "${PUBLIC_IP}" && "${PUBLIC_IP}" != "null" ]]; then
    break
  fi
  sleep 5
done

cat <<EOF

========================================
 VM lista
 Instance : ${INSTANCE_ID}
 IP pública: ${PUBLIC_IP}
 SSH      : ssh ubuntu@${PUBLIC_IP}
 Sitio    : http://${PUBLIC_IP}:3010
========================================

Espera 5-10 minutos a que cloud-init instale Docker y levante AFFiNE.
Si no abre, entra por SSH y revisa:
  sudo tail -n 100 /var/log/cloud-init-output.log
  cd /opt/affine && sudo docker compose ps
EOF
