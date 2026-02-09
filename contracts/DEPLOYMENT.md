# Deployment Guide

## Prerequisites
- Node.js 18+
- Private key with Base Sepolia ETH (get from faucet)

## Fix NPM (if needed)
```bash
sudo chown -R $(whoami) ~/.npm
```

## Install & Deploy
```bash
cd contracts
npm install
PRIVATE_KEY=0x... npx hardhat run scripts/deploy.js --network baseSepolia
```

## Contract Addresses (Base Sepolia - deployed 2026-02-09)
- ReputationRegistry: `0xD6e67da69411734fC2b0A5121365376b02940A36`
- SkillEndorsement: `0x744D23512F5dEA1c861D52a9e4350406e9ffe96e`
- Deployer: `0xb3d43BB82e217104a6E92374e6dE9Ea542e70f9b`
- Network: Base Sepolia (Chain ID 84532)

## Verification
```bash
npx hardhat verify --network baseSepolia <CONTRACT_ADDRESS>
```
