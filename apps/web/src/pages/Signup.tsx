import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { signupSchema, type SignupInput } from "@pnl/shared";
import { AuthLayout } from "@/layouts/AuthLayout";
import { Button, Field, Input } from "@/components/ui";
import { useSignup } from "@/hooks/useAuth";
import { errorMessage } from "@/lib/api";

export function SignupPage() {
  const navigate = useNavigate();
  const signup = useSignup();
  const { register, handleSubmit, formState } = useForm<SignupInput>({ resolver: zodResolver(signupSchema) });
  const e = formState.errors;

  const onSubmit = handleSubmit((v) =>
    signup.mutate(v, {
      onSuccess: () => {
        toast.success("Account ban gaya! Ab integrations connect karo.");
        navigate("/integrations");
      },
      onError: (err) => toast.error(errorMessage(err)),
    }),
  );

  return (
    <AuthLayout title="Brand account banao" subtitle="Har brand ka alag, private dashboard">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Brand / Company name" htmlFor="brandName" error={e.brandName?.message}>
          <Input id="brandName" placeholder="e.g. Kama Ayurveda" {...register("brandName")} />
        </Field>
        <Field label="Aapka naam" htmlFor="name" error={e.name?.message}>
          <Input id="name" autoComplete="name" {...register("name")} />
        </Field>
        <Field label="Email" htmlFor="email" error={e.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
        </Field>
        <Field label="Password" htmlFor="password" error={e.password?.message}>
          <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
        </Field>
        <Button type="submit" className="w-full" loading={signup.isPending}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Account hai?{" "}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Login karo
        </Link>
      </p>
    </AuthLayout>
  );
}
