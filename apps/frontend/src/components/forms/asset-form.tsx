"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { getErrorMessage, sendData } from "@/lib/client/api";
import { focusFirstInvalid, serverFieldErrors, validateFields } from "@/lib/client/form";
import { ASSET_STATUS_OPTIONS, ASSET_TYPE_OPTIONS, ENVIRONMENT_OPTIONS } from "@/lib/format";
import { useToast } from "@/context/toast-context";
import { Alert, Button, ConfirmDialog, Field, FormSection, Input, Modal, Select, Textarea } from "@/components/ui";
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

const FIELDS: Array<keyof AssetFormValues> = [
  "name",
  "assetType",
  "hostname",
  "ipAddress",
  "operatingSystem",
  "environment",
  "location",
  "ownerId",
  "status",
  "description",
];

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
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<AssetFormValues>({ defaultValues: toValues(asset) });

  useEffect(() => {
    if (open) reset(toValues(asset));
  }, [open, asset, reset]);

  const requestClose = () => {
    if (isSubmitting) return;
    if (isDirty) setConfirmDiscard(true);
    else onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    clearErrors("root");
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

    // Same schema the API validates with: field issues are attached to their inputs.
    const validation = validateFields(assetCreateSchema, payload, setError, FIELDS);
    if (!validation.valid) {
      if (validation.formError) setError("root", { message: validation.formError });
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
      return;
    }

    try {
      const saved = asset
        ? await sendData<Asset>("patch", `/assets/${asset.id}`, payload)
        : await sendData<Asset>("post", "/assets", payload);
      toast.success(asset ? "Asset updated" : "Asset registered");
      onSaved(saved);
      reset(toValues(saved));
      onClose();
    } catch (err) {
      const mapped = serverFieldErrors(err, setError, FIELDS);
      if (!mapped.firstField) setError("root", { message: getErrorMessage(err) });
      requestAnimationFrame(() => focusFirstInvalid(formRef.current));
    }
  });

  return (
    <>
      <Modal
        open={open}
        onClose={requestClose}
        title={asset ? "Edit asset" : "Register asset"}
        description="Assets are the inventory that monitoring, findings, incidents and changes attach to."
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={requestClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" form="asset-form" loading={isSubmitting}>
              {asset ? "Save changes" : "Register asset"}
            </Button>
          </>
        }
      >
        <form ref={formRef} id="asset-form" onSubmit={onSubmit} className="space-y-5" noValidate>
          {errors.root?.message ? <Alert tone="danger" title="Could not save this asset">{errors.root.message}</Alert> : null}

          <FormSection title="Identity" description="How operators find this system in the inventory.">
            <Field label="Asset name" htmlFor="asset-name" error={errors.name?.message} required className="sm:col-span-2">
              <Input
                id="asset-name"
                {...register("name")}
                maxLength={160}
                autoComplete="off"
                placeholder="e.g. prod-db-01"
              />
            </Field>
            <Field label="Asset type" htmlFor="asset-type" error={errors.assetType?.message} required>
              <Select id="asset-type" {...register("assetType")}>
                {ASSET_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Environment"
              htmlFor="asset-env"
              error={errors.environment?.message}
              hint="Drives filters, dashboards and change-risk defaults."
              required
            >
              <Select id="asset-env" {...register("environment")}>
                {ENVIRONMENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          </FormSection>

          <FormSection
            title="Network and platform"
            description="Optional. Hostname and IP are validated in the browser and by the API before they are stored."
          >
            <Field label="Hostname" htmlFor="asset-host" error={errors.hostname?.message} hint="Letters, digits, dots and dashes.">
              <Input id="asset-host" {...register("hostname")} maxLength={255} placeholder="server.internal.example" />
            </Field>
            <Field label="IP address" htmlFor="asset-ip" error={errors.ipAddress?.message} hint="IPv4 or IPv6.">
              <Input id="asset-ip" {...register("ipAddress")} maxLength={64} inputMode="text" placeholder="10.0.12.5" />
            </Field>
            <Field label="Operating system" htmlFor="asset-os" error={errors.operatingSystem?.message}>
              <Input id="asset-os" {...register("operatingSystem")} maxLength={120} placeholder="Ubuntu 24.04 LTS" />
            </Field>
            <Field label="Location" htmlFor="asset-loc" error={errors.location?.message}>
              <Input id="asset-loc" {...register("location")} maxLength={160} placeholder="eu-west-1 / Rack B4" />
            </Field>
          </FormSection>

          <FormSection title="Ownership and state">
            <Field
              label="Owner"
              htmlFor="asset-owner"
              error={errors.ownerId?.message}
              hint="The owner is the person operators contact about this asset."
            >
              <Select id="asset-owner" {...register("ownerId")}>
                <option value="">Unassigned</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Status"
              htmlFor="asset-status"
              error={errors.status?.message}
              hint="Assets with a monitoring check are updated automatically from their results."
            >
              <Select id="asset-status" {...register("status")}>
                {ASSET_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Description"
              htmlFor="asset-desc"
              error={errors.description?.message}
              hint="Up to 4,000 characters."
              className="sm:col-span-2"
            >
              <Textarea id="asset-desc" {...register("description")} rows={3} maxLength={4000} />
            </Field>
          </FormSection>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard changes?"
        description="You have unsaved changes to this asset. Closing the dialog will discard them."
        confirmLabel="Discard changes"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          reset(toValues(asset));
          onClose();
        }}
      />
    </>
  );
}
