"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { getErrorMessage, sendData, validatePayload } from "@/lib/client/api";
import { ASSET_STATUS_OPTIONS, ASSET_TYPE_OPTIONS, ENVIRONMENT_OPTIONS } from "@/lib/format";
import { useToast } from "@/context/toast-context";
import { Alert, Button, Field, FormSection, Input, Modal, Select, Textarea } from "@/components/ui";
import { assetCreateSchema } from "@/validators/schemas";
import type { Asset, UserOption } from "@/types/api";

export interface AssetFormValues {
  name: string;
  assetType: string;
  hostname: string;
  ipAddress: string;
  operatingSystem: string;
  environment: string;
  location: string;
  ownerId: string;
  status: string;
  description: string;
}

function toValues(a?: Asset | null): AssetFormValues {
  return {
    name: a?.name ?? "",
    assetType: a?.assetType ?? "virtual_machine",
    hostname: a?.hostname ?? "",
    ipAddress: a?.ipAddress ?? "",
    operatingSystem: a?.operatingSystem ?? "",
    environment: a?.environment ?? "development",
    location: a?.location ?? "",
    ownerId: a?.ownerId ?? "",
    status: a?.status ?? "unknown",
    description: a?.description ?? "",
  };
}

export function AssetFormModal({
  open,
  onClose,
  onSaved,
  asset,
  owners,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
  asset?: Asset | null;
  owners: UserOption[];
}) {
  const toast = useToast();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AssetFormValues>({ defaultValues: toValues(asset) });

  useEffect(() => {
    if (open) reset(toValues(asset));
  }, [open, asset, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const payload = {
      name: values.name.trim(),
      assetType: values.assetType,
      hostname: values.hostname.trim() || null,
      ipAddress: values.ipAddress.trim() || null,
      operatingSystem: values.operatingSystem.trim() || null,
      environment: values.environment,
      location: values.location.trim() || null,
      ownerId: values.ownerId || null,
      description: values.description.trim() || null,
      status: values.status,
    };
    try {
      validatePayload(assetCreateSchema, payload);
    } catch (err) {
      setError("root", { message: getErrorMessage(err) });
      return;
    }
    try {
      const saved = asset
        ? await sendData<Asset>("patch", `/assets/${asset.id}`, payload)
        : await sendData<Asset>("post", "/assets", payload);
      toast.success(asset ? "Asset updated" : "Asset registered");
      onSaved(saved);
      onClose();
    } catch (err) {
      setError("root", { message: getErrorMessage(err) });
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={asset ? "Edit asset" : "Register asset"}
      description="Assets are the inventory that monitoring, findings, incidents and changes attach to."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="asset-form" loading={isSubmitting}>
            {asset ? "Save changes" : "Register asset"}
          </Button>
        </>
      }
    >
      <form id="asset-form" onSubmit={onSubmit} className="space-y-5" noValidate>
        {errors.root?.message ? <Alert tone="danger">{errors.root.message}</Alert> : null}

        <FormSection title="Identity">
          <Field label="Asset name *" htmlFor="asset-name" error={errors.name?.message} className="sm:col-span-2">
            <Input id="asset-name" {...register("name", { required: "Asset name is required" })} placeholder="e.g. prod-db-01" />
          </Field>
          <Field label="Asset type *" htmlFor="asset-type">
            <Select id="asset-type" {...register("assetType")}>
              {ASSET_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Environment *" htmlFor="asset-env">
            <Select id="asset-env" {...register("environment")}>
              {ENVIRONMENT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </FormSection>

        <FormSection title="Network and platform" description="Optional details used to identify the host in the inventory.">
          <Field label="Hostname" htmlFor="asset-host">
            <Input id="asset-host" {...register("hostname")} placeholder="server.internal.example" />
          </Field>
          <Field label="IP address" htmlFor="asset-ip">
            <Input id="asset-ip" {...register("ipAddress")} placeholder="10.0.12.5" />
          </Field>
          <Field label="Operating system" htmlFor="asset-os">
            <Input id="asset-os" {...register("operatingSystem")} placeholder="Ubuntu 24.04 LTS" />
          </Field>
          <Field label="Location" htmlFor="asset-loc">
            <Input id="asset-loc" {...register("location")} placeholder="eu-west-1 / Rack B4" />
          </Field>
        </FormSection>

        <FormSection title="Ownership and state">
          <Field label="Owner" htmlFor="asset-owner">
            <Select id="asset-owner" {...register("ownerId")}>
              <option value="">Unassigned</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="asset-status" hint="Monitored assets are updated automatically from their monitoring checks.">
            <Select id="asset-status" {...register("status")}>
              {ASSET_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description" htmlFor="asset-desc" className="sm:col-span-2">
            <Textarea id="asset-desc" {...register("description")} rows={3} />
          </Field>
        </FormSection>
      </form>
    </Modal>
  );
}
