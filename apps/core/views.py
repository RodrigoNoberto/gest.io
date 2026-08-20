from django.shortcuts import render

def home(request):
    return render(request, "home.html")


def produtos(request):
    return render(request, "produtos.html")


def sobre(request):
    return render(request, "sobre.html")
